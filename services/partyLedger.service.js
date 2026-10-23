import { Op } from 'sequelize';
import {
    Order,
    OrderPayment,
    OrderItem,
    User,
    BusinessProfile,
    SalesReturn,
    PartyBalanceLog,
    PartyLedger,
    PartyLedgerEditLog,
    BankSetting,
    DeliveryBoy,
    ProductVariant
} from '../models/index.js';
import { calculateOrderFinancials } from './financialSettlement.service.js';
import logger from '../logger/apiLogger.js';

/**
 * Helper to format date & time for UI
 */
const formatLedgerDateTime = (d) => {
    const dt = new Date(d);
    const day = String(dt.getDate()).padStart(2, '0');
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const year = dt.getFullYear();
    
    let hours = dt.getHours();
    const minutes = String(dt.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    const hoursStr = String(hours).padStart(2, '0');

    return {
        dateStr: `${day}/${month}/${year}`,
        timeStr: `${hoursStr}:${minutes} ${ampm}`,
        isoDate: dt.toISOString()
    };
};

/**
 * DR / CR flag of a balance (same convention as party opening balance):
 * CR = Baki / Due (positive: party owes admin), DR = Jama / Advance (negative: admin owes party).
 * null when there is no balance.
 */
export const getBalanceType = (balance) => {
    if (balance === null || balance === undefined) return null;
    const n = parseFloat(balance);
    if (n > 0.005) return 'CR';
    if (n < -0.005) return 'DR';
    return null;
};

/**
 * Filter out automatic system-generated notes so RETURN NOTE only displays genuine manual user remarks.
 */
const sanitizeReturnNote = (rawNotes) => {
    if (!rawNotes) return '-';
    const notesArr = Array.isArray(rawNotes) ? rawNotes : [rawNotes];
    const filtered = notesArr
        .map(n => String(n || '').trim())
        .filter(n => {
            if (!n || n === '-' || n === 'null' || n === 'undefined') return false;
            // Clean prefixes like [Base], [Inner]
            const clean = n.replace(/^\[(Base|Inner)\]\s*/i, '').trim().toLowerCase();
            if (!clean) return false;
            // Ignore generic automatic/system notes
            const genericNotes = [
                'return',
                'customer return',
                'customer return at delivery',
                'goods returned',
                'sales return',
                'return item',
                'base return',
                'inner return'
            ];
            if (genericNotes.includes(clean)) return false;
            if (clean.startsWith('return from previous bill')) return false;
            return true;
        })
        .map(n => n.replace(/^\[(Base|Inner)\]\s*/i, '').trim());

    return filtered.length > 0 ? Array.from(new Set(filtered)).join(', ') : '-';
};

// Party balance reset (scripts/resetPartyBalancesToZero.js) — PartyBalanceLog types, amount 0:
// BALANCE_RESET           party line: writes off previousBalance (balance at reset time) -> closing 0
// BALANCE_RESET_CARRY     bill not verified at reset: placed after the reset line (opens at the reset balance)
// BALANCE_RESET_WRITEOFF  bill delivered, not verified at reset: placed after the reset line, its own baki/jama written off
export const BALANCE_RESET = 'BALANCE_RESET';
export const BALANCE_RESET_CARRY = 'BALANCE_RESET_CARRY';
export const BALANCE_RESET_WRITEOFF = 'BALANCE_RESET_WRITEOFF';

// Orders shown in the Party Ledger: Packaging onwards
const LEDGER_ORDER_STATUSES = ['packaging', 'packed', 'shipping', 'delivered', 'payment collect', 'payment verify', 'completed'];
const isLedgerOrder = (ord) => LEDGER_ORDER_STATUSES.includes(String(ord.orderStatus || '').toLowerCase());

/**
 * Time at which a bill takes its place in the running ledger.
 */
const getLedgerOrderTime = (ord) => new Date(ord.deliveredAt || ord.packagingAt || ord.createdAt).getTime();

/**
 * Bills in running-ledger sequence: by bill time, then by bill number.
 * One bill's closing balance is the next bill's opening balance (B-100001 closing -> B-100002 opening),
 * so this order must never depend on DB row order (custom sales share createdAt = sale date midnight).
 */
const sortOrdersForLedger = (orders) => [...orders].sort((a, b) =>
    (getLedgerOrderTime(a) - getLedgerOrderTime(b)) ||
    String(a.orderId || '').localeCompare(String(b.orderId || ''), undefined, { numeric: true })
);

/**
 * Party's orders: by userId, or by customer number for orders placed with the party's phone.
 */
const buildPartyOrderConditions = (user) => {
    const conds = [{ userId: user.id }];
    const cleanUserPhone = user.number ? String(user.number).replace(/\D/g, '').slice(-10) : '';
    if (cleanUserPhone && cleanUserPhone.length >= 7) {
        conds.push({ customerNumber: { [Op.like]: `%${cleanUserPhone}` } });
    }
    return conds;
};

/**
 * Decide which bill each sales return belongs to in the running ledger.
 * Core Running Ledger Rule: Old closed bills must NEVER be mutated!
 * A return created during or after a subsequent bill belongs to that subsequent bill,
 * even if the returned item was originally from a previous bill.
 *
 * @param {Array} eligibleOrders - Bills in ledger sequence (sortOrdersForLedger)
 * @param {Array} allUserReturns - Party's sales returns (not cancelled / rejected), createdAt ASC
 * @returns {{ orderReturnsMap: Map, unassignedStandaloneReturns: Array }}
 */
const assignReturnsToOrders = (eligibleOrders, allUserReturns) => {
    const orderReturnsMap = new Map();
    const unassignedStandaloneReturns = [];

    for (const ord of eligibleOrders) {
        orderReturnsMap.set(ord.id, []);
    }

    for (const ret of allUserReturns) {
        // Stock-only return of a bill cancelled after shipping: the party was never charged for that bill,
        // so it is not a party credit (it only brings the stock back when approved)
        const isCancelledBillReturn = ret.orderId
            && !orderReturnsMap.has(ret.orderId)
            && String(ret.reason || '').trim().toLowerCase().startsWith('cancelled after shipping');
        if (isCancelledBillReturn) continue;

        const retTime = new Date(ret.createdAt || new Date()).getTime();

        if (eligibleOrders.length === 0) {
            unassignedStandaloneReturns.push(ret);
            continue;
        }

        let assignedOrder = null;

        if (ret.orderId && orderReturnsMap.has(ret.orderId)) {
            const targetIdx = eligibleOrders.findIndex(o => o.id === ret.orderId);
            const nextOrder = targetIdx < eligibleOrders.length - 1 ? eligibleOrders[targetIdx + 1] : null;
            const nextOrderTime = nextOrder ? getLedgerOrderTime(nextOrder) : Infinity;

            if (retTime >= nextOrderTime) {
                // Return occurred AFTER this order was already closed and next order was active!
                // Roll forward to the order active at retTime
                let activeOrder = eligibleOrders[eligibleOrders.length - 1];
                for (let j = targetIdx + 1; j < eligibleOrders.length; j++) {
                    const curTime = getLedgerOrderTime(eligibleOrders[j]);
                    const nextTime = j < eligibleOrders.length - 1 ? getLedgerOrderTime(eligibleOrders[j + 1]) : Infinity;
                    if (retTime >= curTime && retTime < nextTime) {
                        activeOrder = eligibleOrders[j];
                        break;
                    }
                }
                assignedOrder = activeOrder;
            } else {
                assignedOrder = eligibleOrders[targetIdx];
            }
        } else {
            // Standalone return or unlinked orderId
            const firstOrderTime = getLedgerOrderTime(eligibleOrders[0]);
            if (retTime < firstOrderTime) {
                unassignedStandaloneReturns.push(ret);
                continue;
            }
            let activeOrder = eligibleOrders[eligibleOrders.length - 1];
            for (let j = 0; j < eligibleOrders.length; j++) {
                const curTime = getLedgerOrderTime(eligibleOrders[j]);
                const nextTime = j < eligibleOrders.length - 1 ? getLedgerOrderTime(eligibleOrders[j + 1]) : Infinity;
                if (retTime >= curTime && retTime < nextTime) {
                    activeOrder = eligibleOrders[j];
                    break;
                }
            }
            assignedOrder = activeOrder;
        }

        if (assignedOrder) {
            const list = orderReturnsMap.get(assignedOrder.id) || [];
            list.push(ret);
            orderReturnsMap.set(assignedOrder.id, list);
        }
    }

    return { orderReturnsMap, unassignedStandaloneReturns };
};

/**
 * A bill as the Party Ledger sees it (same rule as syncPartyLedger): the sales returns shown on it,
 * including returns linked to another bill / no bill that land on this one, and the bill's ledger time.
 * Payment settlement and ledger edits use this, so a return is never recorded twice and a return
 * recorded for this bill (dated billTime) stays on this bill instead of rolling to a later one.
 *
 * @param {string} orderId - Order UUID
 * @param {Object} [options] - { transaction }
 * @returns {Promise<{ inLedger: boolean, billTime: Date|null, returns: Array }>}
 */
export const getLedgerBillReturns = async (orderId, { transaction = null } = {}) => {
    const notInLedger = { inLedger: false, billTime: null, returns: [] };
    if (!orderId) return notInLedger;

    const order = await Order.findByPk(orderId, { attributes: ['id', 'userId'], transaction });
    if (!order || !order.userId) return notInLedger;

    const user = await User.findByPk(order.userId, { attributes: ['id', 'number'], transaction });
    if (!user) return notInLedger;

    const orders = await Order.findAll({
        where: { [Op.or]: buildPartyOrderConditions(user) },
        attributes: ['id', 'orderId', 'orderStatus', 'createdAt', 'packagingAt'],
        transaction
    });
    const eligibleOrders = sortOrdersForLedger(orders.filter(isLedgerOrder));
    const ledgerOrder = eligibleOrders.find(o => o.id === order.id);
    if (!ledgerOrder) return notInLedger;

    const allUserReturns = await SalesReturn.findAll({
        where: {
            userId: user.id,
            status: { [Op.notIn]: ['Cancelled', 'Rejected'] }
        },
        order: [['createdAt', 'ASC']],
        transaction
    });

    const { orderReturnsMap } = assignReturnsToOrders(eligibleOrders, allUserReturns);
    return {
        inLedger: true,
        billTime: new Date(getLedgerOrderTime(ledgerOrder)),
        returns: orderReturnsMap.get(order.id) || []
    };
};

/**
 * Reconstruct and synchronize the entire ledger history for a party.
 *
 * @param {string} userId - UUID or phone of customer
 * @param {Object} [options] - { forceRebuild: boolean, transaction: Object, persist: boolean (false = read only, no DB writes) }
 * @returns {Promise<Object>} { user, summary, ledgerRows, entries }
 */
export const syncPartyLedger = async (userId, { forceRebuild = false, transaction = null, persist = true } = {}) => {
    try {
        if (!userId) throw new Error('User ID is required for party ledger sync');

        let user = null;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId).trim());
        if (isUUID) {
            user = await User.findByPk(userId, {
                include: [{ model: BusinessProfile, as: 'businessProfile' }],
                transaction
            });
        } else {
            const cleanPhone = String(userId).replace(/\D/g, '').slice(-10);
            if (cleanPhone) {
                user = await User.findOne({
                    where: { number: { [Op.like]: `%${cleanPhone}` } },
                    include: [{ model: BusinessProfile, as: 'businessProfile' }],
                    transaction
                });
            }
        }

        if (!user) throw new Error(`User not found: ${userId}`);

        // Fetch all non-cancelled orders for this party
        const orders = await Order.findAll({
            where: { [Op.or]: buildPartyOrderConditions(user) },
            attributes: ['id', 'orderId', 'userId', 'customerNumber', 'orderStatus', 'totalAmount', 'couponDiscount', 'paymentMethod', 'createdAt', 'packagingAt'],
            include: [
                {
                    model: OrderPayment,
                    as: 'payments',
                    attributes: ['id', 'orderId', 'amount', 'paymentMethod', 'bankSettingId', 'deliveryBoyId', 'createdAt'],
                    required: false,
                    include: [
                        { model: BankSetting, as: 'bankAccount', attributes: ['id', 'bankName', 'accountName'] },
                        { model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name'] }
                    ]
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    attributes: ['id', 'orderId', 'returnAmount', 'quantity', 'price', 'reason'],
                    required: false
                },
                {
                    model: OrderItem,
                    as: 'items',
                    attributes: ['id', 'orderId', 'quantity', 'price', 'variantId'],
                    required: false,
                    include: [
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'purchasePrice']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Fetch standalone Sales Returns for this party
        const standaloneReturns = await SalesReturn.findAll({
            where: {
                userId: user.id,
                orderId: null
            },
            attributes: ['id', 'userId', 'returnAmount', 'quantity', 'price', 'reason', 'createdAt'],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Fetch manual balance logs (Opening dues, Adjustments)
        const balanceLogs = await PartyBalanceLog.findAll({
            where: { userId: user.id },
            attributes: ['id', 'userId', 'orderId', 'type', 'amount', 'previousBalance', 'note', 'createdByName', 'createdAt'],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Bills marked by a balance reset: placed right after the reset line; write-off bills keep the balance unchanged
        const resetCarryTime = new Map();
        const resetWriteOffIds = new Set();
        for (const log of balanceLogs) {
            const logType = String(log.type || '').toUpperCase();
            if (log.orderId && (logType === BALANCE_RESET_CARRY || logType === BALANCE_RESET_WRITEOFF)) {
                resetCarryTime.set(log.orderId, new Date(log.createdAt).getTime());
                if (logType === BALANCE_RESET_WRITEOFF) resetWriteOffIds.add(log.orderId);
            }
        }

        // Build Chronological Transactions List
        const chronologicalTransactions = [];

        // Include orders from Packaging onwards (Packaging, Packed, Shipping, Delivered, Payment Collect, Payment Verify, Completed)
        // in running-ledger sequence (bill time, then bill number)
        const eligibleOrders = sortOrdersForLedger(orders.filter(isLedgerOrder));

        // Fetch ALL Sales Returns for this party
        const allUserReturns = await SalesReturn.findAll({
            where: {
                userId: user.id,
                status: { [Op.notIn]: ['Cancelled', 'Rejected'] }
            },
            attributes: ['id', 'userId', 'orderId', 'returnAmount', 'quantity', 'price', 'reason', 'createdAt'],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Map sales returns to orders (Core Running Ledger Rule — see assignReturnsToOrders)
        const { orderReturnsMap, unassignedStandaloneReturns } = assignReturnsToOrders(eligibleOrders, allUserReturns);

        // 1. Process Eligible Orders (Packaging onwards)
        for (const ord of eligibleOrders) {
            const billNo = ord.orderId || String(ord.id).slice(0, 8);
            const fin = calculateOrderFinancials(ord, ord.payments);
            const orderDate = ord.deliveredAt || ord.packagingAt || ord.createdAt || new Date();

            const orderPaymentsList = ord.payments || [];
            const orderItemsList = ord.items || [];
            const attachedReturns = orderReturnsMap.get(ord.id) || [];

            // Sales Amount (Gross Bill)
            const salesAmt = parseFloat(
                fin.totalAmount > 0
                    ? fin.totalAmount
                    : (parseFloat(ord.totalAmount || 0) || 0)
            );

            // Purchase Cost = sum(item.quantity * variant.purchasePrice)
            const purchaseCost = orderItemsList.reduce((sum, it) => {
                const qty = parseFloat(it.quantity || 0);
                const cost = parseFloat(it.variant?.purchasePrice || 0);
                return sum + (qty * cost);
            }, 0);

            // Profit = Sales - Purchase Cost
            const profit = Math.max(0, salesAmt - purchaseCost);

            // Distinguish payment methods:
            const isCashMethod = (m) => String(m || '').toUpperCase() === 'CASH';
            const isBankMethod = (m) => ['ONLINE', 'BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS'].includes(String(m || '').toUpperCase());

            // Payment Breakdown - Only CASH and BANK/ONLINE payments belong to Cash and Bank columns
            // Exclude CREDIT, SALES_RETURN, JAMA_CREDIT, COUPON (these are tracked in their own dedicated columns or balances)
            const validPayments = orderPaymentsList.filter(p => {
                const method = String(p.paymentMethod || '').toUpperCase();
                return (isCashMethod(method) || isBankMethod(method)) && parseFloat(p.amount || 0) > 0;
            });

            const formattedBillNo = billNo.startsWith('B-') || billNo.startsWith('#') ? billNo.replace(/^#/, '') : `B-${billNo}`;
            const orderTimestamp = new Date(orderDate).getTime();

            // Coupon Discount
            const couponDiscount = parseFloat(fin.couponDiscount || ord.couponDiscount || 0);

            // Sales Return on Order (Includes cross-bill returns accepted during this order)
            const returnTotal = attachedReturns.reduce((sum, r) => {
                return sum + parseFloat(r.returnAmount || (parseFloat(r.quantity || 0) * parseFloat(r.price || 0)) || 0);
            }, 0);
            const returnNote = sanitizeReturnNote(attachedReturns.map(r => r.reason));

            // Distinguish payments made at delivery/order time vs subsequent payments:
            let initialCash = 0;
            let initialBank = 0;
            const initialReceivers = [];

            validPayments.forEach(p => {
                const method = String(p.paymentMethod || '').toUpperCase();
                const pAmt = parseFloat(p.amount || 0);
                if (isCashMethod(method)) {
                    initialCash += pAmt;
                } else if (isBankMethod(method)) {
                    initialBank += pAmt;
                    const rName = p.bankAccount?.bankName
                        ? `${p.bankAccount.bankName}${p.bankAccount.accountName ? ` • ${p.bankAccount.accountName}` : ''}`
                        : (p.deliveryBoy?.name ? `Delivery • ${p.deliveryBoy.name}` : null);
                    if (rName) initialReceivers.push(rName);
                }
            });

            // Fallback: If marked Paid or has paidAmount without individual OrderPayment record
            if (validPayments.length === 0 && fin.paidAmount > 0) {
                const fallbackMethod = String(ord.paymentMethod || 'CASH').toUpperCase();
                if (isCashMethod(fallbackMethod)) {
                    initialCash = parseFloat(fin.paidAmount);
                } else if (isBankMethod(fallbackMethod)) {
                    initialBank = parseFloat(fin.paidAmount);
                }
            }

            // Payment fields and closing balance are ONLY populated once payment is verified
            const st = String(ord.orderStatus || '').toLowerCase();
            const isPaymentVerified = ord.paymentCollectStatus === 'Verified' || ['payment verify', 'completed'].includes(st);

            // Exactly ONE row per ORDER in the Party Ledger - Never split orders into duplicate rows
            chronologicalTransactions.push({
                type: 'ORDER',
                orderId: ord.id,
                dateObj: new Date(orderDate),
                billNo: formattedBillNo,
                sales: salesAmt,
                purchaseCost: parseFloat(purchaseCost.toFixed(2)),
                profit: parseFloat(profit.toFixed(2)),
                cash: isPaymentVerified ? parseFloat(initialCash.toFixed(2)) : 0,
                bank: isPaymentVerified ? parseFloat(initialBank.toFixed(2)) : 0,
                bankReceiver: isPaymentVerified ? (initialReceivers.length > 0 ? Array.from(new Set(initialReceivers)).join(', ') : '-') : '-',
                kupan: isPaymentVerified ? parseFloat(couponDiscount.toFixed(2)) : 0,
                returnVal: isPaymentVerified ? parseFloat(returnTotal.toFixed(2)) : 0,
                attachedReturnVal: parseFloat(returnTotal.toFixed(2)),
                returnNote: isPaymentVerified ? returnNote : '-',
                isPaymentVerified,
                balanceResetWriteOff: resetWriteOffIds.has(ord.id),
                // Bill not verified at a balance reset goes right after the reset line (stable sort keeps bill order)
                sortTime: resetCarryTime.has(ord.id) ? resetCarryTime.get(ord.id) + 1 : orderTimestamp
            });
        }

        // 2. Process Standalone Sales Returns
        unassignedStandaloneReturns.forEach((ret, rIdx) => {
            const retDate = ret.createdAt || new Date();
            const retAmt = parseFloat(ret.returnAmount || (parseFloat(ret.quantity || 0) * parseFloat(ret.price || 0)) || 0);
            if (retAmt > 0) {
                chronologicalTransactions.push({
                    type: 'RETURN',
                    orderId: null,
                    dateObj: new Date(retDate),
                    billNo: ret.returnNumber || `RTN-${String(ret.id).slice(0, 6).toUpperCase()}`,
                    sales: 0,
                    purchaseCost: 0,
                    profit: 0,
                    cash: 0,
                    bank: 0,
                    bankReceiver: '-',
                    kupan: 0,
                    returnVal: parseFloat(retAmt.toFixed(2)),
                    returnNote: sanitizeReturnNote(ret.reason),
                    sortTime: new Date(retDate).getTime() + 15 + rIdx
                });
            }
        });

        // 3. Process Independent Manual Adjustments (PartyBalanceLog)
        // ONLY genuine manual adjustments not linked to an order should be processed here!
        for (const log of balanceLogs) {
            // Balance reset line: writes off the party balance as it was at reset time (not counted as cash / sales)
            if (!log.orderId && String(log.type || '').toUpperCase() === BALANCE_RESET) {
                chronologicalTransactions.push({
                    type: 'BALANCE_RESET',
                    orderId: null,
                    dateObj: new Date(log.createdAt),
                    billNo: `RESET-${String(log.id).slice(0, 6).toUpperCase()}`,
                    sales: 0,
                    purchaseCost: 0,
                    profit: 0,
                    cash: 0,
                    bank: 0,
                    bankReceiver: log.createdByName ? `Admin • ${log.createdByName}` : 'Admin',
                    kupan: 0,
                    returnVal: 0,
                    returnNote: '-',
                    balanceResetAmount: parseFloat(log.previousBalance || 0),
                    sortTime: new Date(log.createdAt).getTime()
                });
                continue;
            }

            // NEVER process logs linked to an order! Order dues/credits are handled through Order itself.
            if (log.orderId) continue;

            const autoNote = String(log.note || '').toLowerCase();
            if (
                autoNote.includes('overpayment') ||
                autoNote.includes('credit jama on order') ||
                autoNote.includes('jama balance') ||
                autoNote.includes('cash/online overpayment') ||
                autoNote.includes('admin settlement') ||
                autoNote.includes('delivery settlement') ||
                autoNote.includes('delivery boy settlement') ||
                autoNote.includes('credit (baki)') ||
                autoNote.includes('goods given on credit') ||
                autoNote.includes('order #') ||
                autoNote.includes('on order') ||
                autoNote.includes('advance jama on order') ||
                autoNote.includes('advance jama used on order') ||
                autoNote.includes('past due cleared') ||
                autoNote.includes('settled during delivery')
            ) {
                continue;
            }

            const logAmt = parseFloat(log.amount || 0);
            if (logAmt <= 0) continue;

            const logType = String(log.type || '').toUpperCase();
            const logDate = log.createdAt || new Date();

            if (logType === 'JAMA' || logType === 'PAYMENT') {
                chronologicalTransactions.push({
                    type: 'ADJUSTMENT_CR',
                    orderId: null,
                    dateObj: new Date(logDate),
                    billNo: `PAY-${String(log.id).slice(0, 6).toUpperCase()}`,
                    sales: 0,
                    purchaseCost: 0,
                    profit: 0,
                    cash: logAmt,
                    bank: 0,
                    bankReceiver: log.createdByName ? `Admin • ${log.createdByName}` : 'Admin',
                    kupan: 0,
                    returnVal: 0,
                    returnNote: '-', // Never place automatic return note!
                    sortTime: new Date(logDate).getTime()
                });
            } else if (logType === 'BAKI' || logType === 'DUE') {
                chronologicalTransactions.push({
                    type: 'ADJUSTMENT_DR',
                    orderId: null,
                    dateObj: new Date(logDate),
                    billNo: `OPN-${String(log.id).slice(0, 6).toUpperCase()}`,
                    sales: logAmt,
                    purchaseCost: 0,
                    profit: 0,
                    cash: 0,
                    bank: 0,
                    bankReceiver: '-',
                    kupan: 0,
                    returnVal: 0,
                    returnNote: '-', // Never place automatic return note!
                    sortTime: new Date(logDate).getTime()
                });
            }
        }

        // Initial Opening Balance for Party
        const rawOpeningAmt = Math.max(0, parseFloat(user.openingBalance || 0));
        const opType = String(user.openingBalanceType || 'CR').toUpperCase();
        // CR = Baki / Due (Positive balance: customer owes admin)
        // DR = Jama / Advance (Negative balance: customer has advance deposit with admin)
        const initialPartyOpeningBalance = opType === 'DR' ? -rawOpeningAmt : rawOpeningAmt;

        // Running ledger follows time: each row's closing balance is the next row's opening balance.
        // Stable sort keeps bills with the same time in bill-number order.
        chronologicalTransactions.sort((a, b) => a.sortTime - b.sortTime);

        // Hisab starts again at the latest Balance Reset: rows dated before it stay in the ledger (no bill is removed)
        // but are not counted in the summary totals (sales, cash, bank, kupan, return, purchase, profit)
        const latestResetTime = chronologicalTransactions
            .filter(tx => tx.type === 'BALANCE_RESET')
            .reduce((latest, tx) => Math.max(latest, tx.dateObj.getTime()), 0);

        // Build continuous Running Ledger Rows
        let runningBalance = initialPartyOpeningBalance;
        const allBuiltRows = chronologicalTransactions.map((tx, idx) => {
            const dt = formatLedgerDateTime(tx.dateObj);
            const openingBalance = runningBalance;
            const totalAmount = parseFloat((openingBalance + tx.sales).toFixed(2));

            let closingBalance = null;
            if (tx.isPaymentVerified !== false) {
                const creditsTotal = tx.cash + tx.bank + tx.kupan + tx.returnVal;
                closingBalance = parseFloat((totalAmount - creditsTotal).toFixed(2));
                if (tx.type === 'BALANCE_RESET') {
                    // Write off the balance as it was at reset time
                    closingBalance = parseFloat((totalAmount - tx.balanceResetAmount).toFixed(2));
                } else if (tx.balanceResetWriteOff) {
                    // Bill written off by a balance reset: its own baki / jama does not change the balance
                    closingBalance = parseFloat(openingBalance.toFixed(2));
                }
                runningBalance = closingBalance;
            }

            return {
                sr: idx + 1,
                date: dt.dateStr,
                time: dt.timeStr,
                isoDate: dt.isoDate,
                dateObj: tx.dateObj,
                billNo: tx.billNo,
                orderId: tx.orderId,
                openingBalance: parseFloat(openingBalance.toFixed(2)),
                sales: parseFloat(tx.sales.toFixed(2)),
                totalAmount: totalAmount,
                purchaseCost: parseFloat(tx.purchaseCost.toFixed(2)),
                profit: parseFloat(tx.profit.toFixed(2)),
                cash: parseFloat(tx.cash.toFixed(2)),
                bank: parseFloat(tx.bank.toFixed(2)),
                bankReceiver: tx.bankReceiver,
                kupan: parseFloat(tx.kupan.toFixed(2)),
                returnVal: parseFloat(tx.returnVal.toFixed(2)),
                attachedReturnVal: parseFloat((tx.attachedReturnVal || tx.returnVal || 0).toFixed(2)),
                returnNote: tx.returnNote,
                closingBalance: closingBalance,
                closingBalanceType: getBalanceType(closingBalance),
                isPaymentVerified: tx.isPaymentVerified !== false,
                isBalanceReset: tx.type === 'BALANCE_RESET',
                isBalanceResetWriteOff: Boolean(tx.balanceResetWriteOff),
                isBeforeReset: latestResetTime > 0 && tx.dateObj.getTime() < latestResetTime
            };
        });

        // Synchronize User Model closingBalance as single source of truth (from verified transactions)
        const latestClosingBalance = runningBalance;

        if (persist && user) {
            try {
                user.closingBalance = latestClosingBalance;
                await user.save({ transaction });
            } catch (uErr) {
                logger.warn(`[syncPartyLedger User update warning]: ${uErr.message}`);
            }
        }

        // Synchronize Order dueAmount ONLY for verified orders
        const verifiedOrderRows = allBuiltRows.filter(r => r.orderId && r.isPaymentVerified);
        if (persist && verifiedOrderRows.length > 0) {
            const lastVerifiedOrder = verifiedOrderRows[verifiedOrderRows.length - 1];
            for (const r of verifiedOrderRows) {
                try {
                    const isLast = r.orderId === lastVerifiedOrder.orderId;
                    const targetDue = isLast ? (latestClosingBalance > 0 ? latestClosingBalance : 0) : 0;
                    await Order.update(
                        {
                            dueAmount: targetDue,
                            creditAmount: targetDue,
                            paymentStatus: targetDue <= 1e-7 ? 'Paid' : 'Partial'
                        },
                        { where: { id: r.orderId }, transaction }
                    );
                } catch (ordErr) {
                    logger.warn(`[syncPartyLedger Order update warning]: ${ordErr.message}`);
                }
            }
        }

        // Bills written off by a balance reset and not verified yet: no due of their own
        const writtenOffPendingRows = allBuiltRows.filter(r => r.orderId && r.isBalanceResetWriteOff && !r.isPaymentVerified);
        if (persist && writtenOffPendingRows.length > 0) {
            try {
                await Order.update(
                    { dueAmount: 0 },
                    { where: { id: writtenOffPendingRows.map(r => r.orderId) }, transaction }
                );
            } catch (ordErr) {
                logger.warn(`[syncPartyLedger written-off Order update warning]: ${ordErr.message}`);
            }
        }

        return {
            user: {
                id: user.id,
                fullname: user.fullname,
                shopName: user.businessProfile?.shopName || user.businessProfile?.shopNameAlt || user.fullname,
                mobile: user.number ? `+91 ${user.number}` : '',
                route: user.city || 'Main Route (A1)',
                kycStatus: user.kycverification === 'verified' ? 'KYC Verified' : 'KYC Pending',
                creditline: parseFloat(user.creditline || 0),
                closingBalance: latestClosingBalance,
                currentDue: latestClosingBalance > 0 ? latestClosingBalance : 0,
                advanceJama: latestClosingBalance < 0 ? Math.abs(latestClosingBalance) : 0,
                balanceType: latestClosingBalance > 0 ? 'DUE' : (latestClosingBalance < 0 ? 'JAMA' : 'CLEAR'),
                openingBalance: rawOpeningAmt,
                openingBalanceType: opType,
                isOpeningBalanceSet: Boolean(user.isOpeningBalanceSet)
            },
            ledgerRows: allBuiltRows,
            closingBalance: latestClosingBalance
        };
    } catch (error) {
        logger.error(`[syncPartyLedger Error for userId ${userId}]: ${error.message}`);
        throw error;
    }
};

/**
 * Own due of a delivered bill that is not in the ledger yet (not payment verified):
 * recorded at delivery (CREDIT / dueAmount), else bill minus cash / online received.
 */
export const getDeliveredBillDue = (order, payments = []) => {
    const fin = calculateOrderFinancials(order, payments);
    let due = parseFloat(fin.dueAmount || 0);
    if (due <= 0 && order.dueAmount !== undefined && order.dueAmount !== null) {
        due = parseFloat(order.dueAmount) || 0;
    }
    if (due <= 0) {
        const netPayable = parseFloat(fin.netPayable || 0);
        const nonCreditPaid = parseFloat(fin.nonCreditPaid || 0);
        if (netPayable > nonCreditPaid + 0.01) {
            due = netPayable - nonCreditPaid;
        }
    }
    return parseFloat(Math.max(0, due).toFixed(2));
};

/**
 * Party's due right now, from the Party Ledger — single source for every "past due / used due / credit" figure.
 * Verified bills are carried bill to bill into the ledger balance. The latest delivered bill that is not verified
 * yet is not in the ledger: its own due (recorded at delivery, incl. the balance carried till then) is the party's
 * due, unless a balance reset wrote it off. Old bills' own CREDIT records are never added up.
 *
 * @param {string} userId - Party (User) UUID
 * @param {Object} [options] - { excludeOrderId: bill being delivered / settled now, transaction }
 * @returns {Promise<{ ledgerBalance: number, totalDue: number, advanceJama: number, dueBill: Object|null }>}
 */
export const getPartyCurrentDue = async (userId, { excludeOrderId = null, transaction = null } = {}) => {
    const ledger = await syncPartyLedger(userId, { persist: false, transaction });
    const ledgerBalance = parseFloat(parseFloat(ledger.closingBalance || 0).toFixed(2));
    const rows = (ledger.ledgerRows || []).filter(r => r.orderId && String(r.orderId) !== String(excludeOrderId || ''));

    // Latest delivered bill in ledger sequence (verified bills are delivered; in-flight bills are skipped)
    const unverifiedIds = rows.filter(r => !r.isPaymentVerified).map(r => r.orderId);
    const unverifiedOrders = unverifiedIds.length > 0
        ? await Order.findAll({
            where: { id: unverifiedIds },
            attributes: ['id', 'orderId', 'orderStatus', 'totalAmount', 'couponDiscount', 'deliveryCharge', 'paidAmount', 'dueAmount', 'paymentStatus', 'paymentMethod', 'createdAt'],
            transaction
        })
        : [];
    const unverifiedById = new Map(unverifiedOrders.map(o => [String(o.id), o]));
    const deliveredStatuses = ['delivered', 'payment collect', 'payment verify', 'completed'];

    let latestVerifiedRow = null;
    let pendingDeliveredOrder = null;
    let pendingDeliveredRow = null;
    for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (r.isPaymentVerified) {
            latestVerifiedRow = r;
            break;
        }
        const ord = unverifiedById.get(String(r.orderId));
        if (ord && deliveredStatuses.includes(String(ord.orderStatus || '').toLowerCase())) {
            pendingDeliveredOrder = ord;
            pendingDeliveredRow = r;
            break;
        }
    }

    if (pendingDeliveredOrder && !pendingDeliveredRow.isBalanceResetWriteOff) {
        const payments = await OrderPayment.findAll({
            where: { orderId: pendingDeliveredOrder.id },
            attributes: ['id', 'amount', 'paymentMethod', 'notes'],
            transaction
        });
        const due = getDeliveredBillDue(pendingDeliveredOrder, payments);
        return {
            ledgerBalance,
            totalDue: due,
            advanceJama: 0,
            dueBill: due > 0.01 ? {
                id: pendingDeliveredOrder.id,
                orderId: pendingDeliveredOrder.orderId,
                totalAmount: parseFloat(pendingDeliveredOrder.totalAmount || 0),
                couponDiscount: parseFloat(pendingDeliveredOrder.couponDiscount || 0),
                paidAmount: parseFloat(pendingDeliveredOrder.paidAmount || 0),
                dueAmount: due,
                paymentStatus: 'Partial',
                orderStatus: pendingDeliveredOrder.orderStatus,
                createdAt: pendingDeliveredOrder.createdAt
            } : null
        };
    }

    if (!latestVerifiedRow) {
        latestVerifiedRow = [...rows].reverse().find(r => r.isPaymentVerified) || null;
    }
    return {
        ledgerBalance,
        totalDue: Math.max(0, ledgerBalance),
        advanceJama: ledgerBalance < 0 ? Math.abs(ledgerBalance) : 0,
        dueBill: ledgerBalance > 0.01 ? {
            id: latestVerifiedRow ? latestVerifiedRow.orderId : 'prior-due',
            orderId: latestVerifiedRow ? String(latestVerifiedRow.billNo || '').replace(/^B-/, '') : 'Previous Due',
            totalAmount: latestVerifiedRow ? parseFloat(latestVerifiedRow.sales || 0) : ledgerBalance,
            couponDiscount: latestVerifiedRow ? parseFloat(latestVerifiedRow.kupan || 0) : 0,
            paidAmount: latestVerifiedRow ? parseFloat(((latestVerifiedRow.cash || 0) + (latestVerifiedRow.bank || 0)).toFixed(2)) : 0,
            dueAmount: ledgerBalance,
            paymentStatus: 'Partial',
            orderStatus: 'Payment Verify',
            createdAt: latestVerifiedRow ? latestVerifiedRow.dateObj : new Date()
        } : null
    };
};

/**
 * Get Party Ledger with date filtering, search, and UI-accurate summary cards.
 *
 * @param {string} userId - UUID or Phone of customer
 * @param {Object} query - { startDate, endDate, search, limit, page }
 * @returns {Promise<Object>}
 */
export const getPartyLedger = async (userId, query = {}) => {
    try {
        const { startDate, endDate, search } = query;

        const synced = await syncPartyLedger(userId, { forceRebuild: true });
        const allRows = synced.ledgerRows || [];

        // Apply Date Range Filter if provided
        let startTimestamp = null;
        let endTimestamp = null;
        if (startDate) {
            startTimestamp = new Date(`${startDate}T00:00:00.000Z`).getTime();
        }
        if (endDate) {
            endTimestamp = new Date(`${endDate}T23:59:59.999Z`).getTime();
        }

        const rawOpeningAmt = Math.max(0, parseFloat(synced.user?.openingBalance || 0));
        const opType = String(synced.user?.openingBalanceType || 'CR').toUpperCase();
        const initialPartyOpeningBalance = opType === 'DR' ? -rawOpeningAmt : rawOpeningAmt;

        let filteredRows = allRows;
        let periodOpeningBalance = initialPartyOpeningBalance;

        if (startTimestamp || endTimestamp) {
            const priorRows = allRows.filter(r => startTimestamp ? r.dateObj.getTime() < startTimestamp : false);
            if (priorRows.length > 0) {
                periodOpeningBalance = priorRows[priorRows.length - 1].closingBalance;
            } else if (allRows.length > 0) {
                periodOpeningBalance = allRows[0].openingBalance;
            } else {
                periodOpeningBalance = initialPartyOpeningBalance;
            }

            filteredRows = allRows.filter(r => {
                const t = r.dateObj.getTime();
                if (startTimestamp && t < startTimestamp) return false;
                if (endTimestamp && t > endTimestamp) return false;
                return true;
            });
        } else if (allRows.length > 0) {
            periodOpeningBalance = allRows[0].openingBalance;
        } else {
            periodOpeningBalance = initialPartyOpeningBalance;
        }

        // Apply Bill Search Filter if provided
        if (search && search.trim()) {
            const q = search.toLowerCase().trim();
            filteredRows = filteredRows.filter(r =>
                r.billNo.toLowerCase().includes(q) ||
                (r.bankReceiver && r.bankReceiver.toLowerCase().includes(q)) ||
                (r.returnNote && r.returnNote.toLowerCase().includes(q))
            );
        }

        // Re-index SR for filtered view
        filteredRows = filteredRows.map((r, idx) => ({
            ...r,
            sr: idx + 1
        }));

        // Compute Summary Totals for UI Cards (hisab from the latest Balance Reset: older rows are not counted)
        const totals = filteredRows.filter(r => !r.isBeforeReset).reduce((acc, r) => {
            acc.periodSales += r.sales || 0;
            acc.totalAmount += r.totalAmount || 0;
            acc.purchaseCost += r.purchaseCost || 0;
            acc.profit += r.profit || 0;
            acc.cash += r.cash || 0;
            acc.bank += r.bank || 0;
            acc.kupan += r.kupan || 0;
            acc.returnVal += r.returnVal || 0;
            return acc;
        }, {
            periodSales: 0,
            totalAmount: 0,
            purchaseCost: 0,
            profit: 0,
            cash: 0,
            bank: 0,
            kupan: 0,
            returnVal: 0
        });

        const verifiedFiltered = filteredRows.filter(r => r.closingBalance !== null && r.closingBalance !== undefined);
        const periodClosingBalance = verifiedFiltered.length > 0
            ? verifiedFiltered[verifiedFiltered.length - 1].closingBalance
            : periodOpeningBalance;

        const latestRowOpening = filteredRows.length > 0
            ? filteredRows[filteredRows.length - 1].openingBalance
            : periodOpeningBalance;

        return {
            user: synced.user,
            summary: {
                openingBalance: parseFloat(latestRowOpening.toFixed(2)),
                initialOpeningBalance: rawOpeningAmt,
                initialOpeningBalanceType: opType,
                isOpeningBalanceSet: Boolean(synced.user?.isOpeningBalanceSet),
                periodSales: parseFloat(totals.periodSales.toFixed(2)),
                totalAmount: parseFloat((latestRowOpening + totals.periodSales).toFixed(2)),
                purchaseCost: parseFloat(totals.purchaseCost.toFixed(2)),
                profit: parseFloat(totals.profit.toFixed(2)),
                cash: parseFloat(totals.cash.toFixed(2)),
                bank: parseFloat(totals.bank.toFixed(2)),
                kupan: parseFloat(totals.kupan.toFixed(2)),
                returnVal: parseFloat(totals.returnVal.toFixed(2)),
                closingBalance: parseFloat(synced.closingBalance.toFixed(2)),
                closingBalanceType: getBalanceType(synced.closingBalance),
                periodClosingBalance: parseFloat(periodClosingBalance.toFixed(2)),
                periodClosingBalanceType: getBalanceType(periodClosingBalance),
                totalRows: filteredRows.length
            },
            ledgerRows: filteredRows
        };
    } catch (error) {
        logger.error(`[getPartyLedger Error]: ${error.message}`);
        throw error;
    }
};

/**
 * Add manual Debit / Credit voucher to party ledger
 */
export const recordManualPartyEntry = async ({
    userId,
    entryType,
    amount,
    date = new Date(),
    particulars = '',
    paymentMethod = 'CASH',
    note = '',
    createdById = null,
    createdByName = 'Admin'
}) => {
    const isCredit = entryType === 'CREDIT' || entryType === 'JAMA' || entryType === 'PAYMENT';
    const logType = isCredit ? 'JAMA' : 'BAKI';

    const log = await PartyBalanceLog.create({
        userId,
        orderId: null,
        type: logType,
        amount: Math.max(0, parseFloat(amount || 0)),
        previousBalance: 0,
        newBalance: 0,
        note: note || particulars || (isCredit ? 'Manual Credit Entry' : 'Manual Debit Entry'),
        createdById,
        createdByName
    });

    await syncPartyLedger(userId, { forceRebuild: true });
    return log;
};

/**
 * Retrieve edit audit history for a specific bill or transaction
 */
export const getPartyLedgerEditHistory = async (userId, billNo) => {
    try {
        const cleanBill = String(billNo || '').replace(/^#/, '');
        const rawBill = cleanBill.replace(/^B-/, '');
        const whereCond = {
            [Op.or]: [
                { billNo: cleanBill },
                { billNo: rawBill },
                { billNo: `B-${rawBill}` }
            ]
        };
        if (userId) {
            whereCond.userId = userId;
        }
        const history = await PartyLedgerEditLog.findAll({
            where: whereCond,
            order: [['createdAt', 'DESC']],
            limit: 50
        });
        return history.map((h, idx) => {
            const dt = formatLedgerDateTime(h.createdAt);
            return {
                id: h.id,
                sr: idx + 1,
                date: dt.dateStr,
                time: dt.timeStr,
                dateTimeStr: `${dt.dateStr} ${dt.timeStr}`,
                updatedBy: h.updatedByName || 'Admin',
                field: h.field,
                oldValue: h.oldValue,
                newValue: h.newValue,
                reason: h.reason || '-'
            };
        });
    } catch (err) {
        logger.error(`[getPartyLedgerEditHistory Error]: ${err.message}`);
        return [];
    }
};

/**
 * Update transaction payments (Cash, Bank, Kupan, Return, Bank Receiver, Return Note, Remarks)
 * and persist audit edit history (Previous vs Updated Values)
 */
export const updatePartyLedgerTransaction = async ({
    userId,
    billNo,
    orderId = null,
    cash = 0,
    bank = 0,
    kupan = 0,
    returnVal = 0,
    bankReceiver = '',
    bankSettingId = null,
    returnNote = '',
    remarks = '',
    adminUser = null
}) => {
    try {
        if (!userId) throw new Error('User ID is required');

        const user = await User.findByPk(userId);
        if (!user) throw new Error('Customer user not found');

        let order = null;
        if (orderId) {
            order = await Order.findByPk(orderId, {
                include: [
                    { model: OrderPayment, as: 'payments' },
                    { model: SalesReturn, as: 'returns' }
                ]
            });
        }
        if (!order && billNo) {
            const rawBill = String(billNo).replace(/^B-|^#/, '');
            order = await Order.findOne({
                where: {
                    [Op.or]: [
                        { orderId: rawBill },
                        { orderId: `B-${rawBill}` },
                        { orderId: billNo },
                        { id: rawBill }
                    ]
                },
                include: [
                    { model: OrderPayment, as: 'payments' },
                    { model: SalesReturn, as: 'returns' }
                ]
            });
        }

        const formattedBillNo = billNo || (order ? (order.orderId ? `B-${order.orderId}` : String(order.id).slice(0, 8)) : 'B-UNKNOWN');
        const updatedByName = adminUser?.name || adminUser?.fullname || 'Admin';
        const updatedById = adminUser?.id || null;

        if (order) {
            // Validate: only allow editing transactions within the last 3 dates (Today, Yesterday, Day Before Yesterday)
            // Same date the ledger row shows (deliveredAt → packagingAt → createdAt), so it matches the row's edit button
            const ledgerDate = order.deliveredAt || order.packagingAt || order.createdAt;
            const orderDate = ledgerDate ? new Date(ledgerDate) : null;
            if (orderDate && !isNaN(orderDate.getTime())) {
                const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
                const todayStr = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, '0')}-${String(istNow.getUTCDate()).padStart(2, '0')}`;
                const todayDate = new Date(`${todayStr}T00:00:00`);
                const cutoffDate = new Date(todayDate);
                cutoffDate.setDate(cutoffDate.getDate() - 2);
                const cutoffStr = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, '0')}-${String(cutoffDate.getDate()).padStart(2, '0')}`;

                const orderIst = new Date(orderDate.getTime() + 5.5 * 60 * 60 * 1000);
                const orderDateStr = `${orderIst.getUTCFullYear()}-${String(orderIst.getUTCMonth() + 1).padStart(2, '0')}-${String(orderIst.getUTCDate()).padStart(2, '0')}`;

                if (orderDateStr < cutoffStr) {
                    throw new Error('માત્ર છેલ્લા ૩ દિવસ (Last 3 dates) ના રેકોર્ડ જ એડિટ કરી શકાય છે.');
                }
            }

            const payments = order.payments || [];
            const currentCash = payments
                .filter(p => String(p.paymentMethod || '').toUpperCase() === 'CASH')
                .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

            const currentBank = payments
                .filter(p => ['ONLINE', 'BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS'].includes(String(p.paymentMethod || '').toUpperCase()))
                .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

            const currentKupan = parseFloat(order.couponDiscount || 0);
            // Exactly the returns this ledger row shows (incl. returns linked to another bill that land here)
            const ledgerBill = await getLedgerBillReturns(order.id);
            const returns = ledgerBill.inLedger ? ledgerBill.returns : (order.returns || []);
            const currentReturn = returns.reduce((sum, r) => sum + parseFloat(r.returnAmount || (parseFloat(r.quantity || 0) * parseFloat(r.price || 0)) || 0), 0);
            const currentReturnNote = sanitizeReturnNote(returns.map(r => r.reason));

            const newCashVal = Math.max(0, parseFloat(cash || 0));
            const newBankVal = Math.max(0, parseFloat(bank || 0));
            const newKupanVal = Math.max(0, parseFloat(kupan || 0));
            const newReturnVal = Math.max(0, parseFloat(returnVal || 0));

            const changes = [];
            if (Math.abs(newCashVal - currentCash) > 0.009) {
                changes.push({ field: 'Cash', oldValue: `₹${currentCash.toFixed(2)}`, newValue: `₹${newCashVal.toFixed(2)}` });
            }
            if (Math.abs(newBankVal - currentBank) > 0.009) {
                changes.push({ field: 'Bank', oldValue: `₹${currentBank.toFixed(2)}`, newValue: `₹${newBankVal.toFixed(2)}` });
            }
            if (Math.abs(newKupanVal - currentKupan) > 0.009) {
                changes.push({ field: 'Kupan', oldValue: `₹${currentKupan.toFixed(2)}`, newValue: `₹${newKupanVal.toFixed(2)}` });
            }
            if (Math.abs(newReturnVal - currentReturn) > 0.009) {
                changes.push({ field: 'Return', oldValue: `₹${currentReturn.toFixed(2)}`, newValue: `₹${newReturnVal.toFixed(2)}` });
            }
            if (returnNote && returnNote !== currentReturnNote && returnNote !== '-') {
                changes.push({ field: 'Return Note', oldValue: currentReturnNote, newValue: returnNote });
            }
            if (bankReceiver && bankReceiver !== '-') {
                changes.push({ field: 'Bank Receiver', oldValue: '-', newValue: bankReceiver });
            }

            // Persist Edit Audit History
            for (const chg of changes) {
                await PartyLedgerEditLog.create({
                    userId: user.id,
                    orderId: order.id,
                    billNo: formattedBillNo,
                    field: chg.field,
                    oldValue: chg.oldValue,
                    newValue: chg.newValue,
                    reason: remarks || 'Amount correction',
                    updatedById,
                    updatedByName
                });
            }

            // Update Cash payments
            const cashPayments = payments.filter(p => String(p.paymentMethod || '').toUpperCase() === 'CASH');
            if (newCashVal > 0) {
                if (cashPayments.length > 0) {
                    const primaryCash = cashPayments[0];
                    primaryCash.amount = newCashVal;
                    primaryCash.notes = remarks || primaryCash.notes;
                    await primaryCash.save();
                    for (let i = 1; i < cashPayments.length; i++) {
                        await cashPayments[i].destroy();
                    }
                } else {
                    await OrderPayment.create({
                        orderId: order.id,
                        amount: newCashVal,
                        paymentMethod: 'CASH',
                        notes: remarks || 'Cash payment updated via Ledger'
                    });
                }
            } else if (cashPayments.length > 0) {
                for (const cp of cashPayments) {
                    await cp.destroy();
                }
            }

            // Update Bank / Online payments
            const bankPayments = payments.filter(p => ['ONLINE', 'BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS'].includes(String(p.paymentMethod || '').toUpperCase()));
            if (newBankVal > 0) {
                if (bankPayments.length > 0) {
                    const primaryBank = bankPayments[0];
                    primaryBank.amount = newBankVal;
                    if (bankSettingId) primaryBank.bankSettingId = bankSettingId;
                    primaryBank.notes = remarks || primaryBank.notes;
                    await primaryBank.save();
                    for (let i = 1; i < bankPayments.length; i++) {
                        await bankPayments[i].destroy();
                    }
                } else {
                    await OrderPayment.create({
                        orderId: order.id,
                        amount: newBankVal,
                        paymentMethod: 'ONLINE',
                        bankSettingId: bankSettingId || null,
                        notes: remarks || 'Bank payment updated via Ledger'
                    });
                }
            } else if (bankPayments.length > 0) {
                for (const bp of bankPayments) {
                    await bp.destroy();
                }
            }

            // Update Coupon discount
            order.couponDiscount = newKupanVal;

            // Update Sales Return
            if (newReturnVal > 0) {
                if (returns.length > 0) {
                    const primaryReturn = returns[0];
                    primaryReturn.returnAmount = newReturnVal;
                    primaryReturn.price = newReturnVal;
                    if (returnNote) primaryReturn.reason = returnNote;

                    if (!primaryReturn.productId || !primaryReturn.variantId) {
                        let orderItem = await OrderItem.findOne({ where: { orderId: order.id } });
                        if (!orderItem) {
                            orderItem = await OrderItem.findOne({ where: { orderId: order.id }, paranoid: false });
                        }
                        if (orderItem) {
                            if (!primaryReturn.productId) primaryReturn.productId = orderItem.productId;
                            if (!primaryReturn.variantId) primaryReturn.variantId = orderItem.variantId;
                            if (!primaryReturn.volumeId && orderItem.volumeId) primaryReturn.volumeId = orderItem.volumeId;
                        } else {
                            const fallbackVariant = await ProductVariant.findOne({ attributes: ['id', 'productId', 'volumeId'] });
                            if (fallbackVariant) {
                                if (!primaryReturn.productId) primaryReturn.productId = fallbackVariant.productId;
                                if (!primaryReturn.variantId) primaryReturn.variantId = fallbackVariant.id;
                                if (!primaryReturn.volumeId && fallbackVariant.volumeId) primaryReturn.volumeId = fallbackVariant.volumeId;
                            }
                        }
                    }

                    await primaryReturn.save();
                    for (let i = 1; i < returns.length; i++) {
                        await returns[i].destroy();
                    }
                } else {
                    let orderItem = await OrderItem.findOne({ where: { orderId: order.id } });
                    if (!orderItem) {
                        orderItem = await OrderItem.findOne({ where: { orderId: order.id }, paranoid: false });
                    }

                    let targetProductId = orderItem?.productId;
                    let targetVariantId = orderItem?.variantId;
                    let targetVolumeId = orderItem?.volumeId || null;

                    if (!targetProductId || !targetVariantId) {
                        const fallbackVariant = await ProductVariant.findOne({ attributes: ['id', 'productId', 'volumeId'] });
                        if (fallbackVariant) {
                            targetProductId = fallbackVariant.productId;
                            targetVariantId = fallbackVariant.id;
                            targetVolumeId = fallbackVariant.volumeId || null;
                        }
                    }

                    await SalesReturn.create({
                        orderId: order.id,
                        userId: user.id,
                        productId: targetProductId,
                        variantId: targetVariantId,
                        volumeId: targetVolumeId,
                        returnAmount: newReturnVal,
                        price: newReturnVal,
                        quantity: 1,
                        reason: returnNote || 'Return recorded via Ledger',
                        creditProcessed: true,
                        status: 'Approved'
                    });
                }
            } else if (returns.length > 0) {
                for (const ret of returns) {
                    await ret.destroy();
                }
            }

            // Update Order paid amount
            order.paidAmount = newCashVal + newBankVal;
            await order.save();
        } else {
            // For manual ledger rows / balance adjustments
            const newCashVal = Math.max(0, parseFloat(cash || 0));
            const newBankVal = Math.max(0, parseFloat(bank || 0));
            const totalCredits = newCashVal + newBankVal;

            if (totalCredits > 0) {
                await PartyBalanceLog.create({
                    userId: user.id,
                    orderId: null,
                    type: 'JAMA',
                    amount: totalCredits,
                    previousBalance: 0,
                    newBalance: 0,
                    note: remarks || `Ledger adjustment for ${formattedBillNo}`,
                    createdById: updatedById,
                    createdByName: updatedByName
                });
            }

            await PartyLedgerEditLog.create({
                userId: user.id,
                orderId: null,
                billNo: formattedBillNo,
                field: 'Adjustment',
                oldValue: '-',
                newValue: `Cash: ₹${newCashVal.toFixed(2)}, Bank: ₹${newBankVal.toFixed(2)}`,
                reason: remarks || 'Manual entry update',
                updatedById,
                updatedByName
            });
        }

        // Re-sync authoritative party ledger and closing balance
        const updatedLedger = await syncPartyLedger(user.id, { forceRebuild: true });
        const updatedHistory = await getPartyLedgerEditHistory(user.id, formattedBillNo);

        return {
            success: true,
            message: 'Transaction updated successfully',
            ledger: updatedLedger,
            history: updatedHistory
        };
    } catch (error) {
        logger.error(`[updatePartyLedgerTransaction Error]: ${error.message}`);
        throw error;
    }
};

/**
 * Update one-time party opening balance (DR = Debit / Jama / Advance, CR = Credit / Baki / Due)
 */
export const updatePartyOpeningBalance = async ({ userId, amount, type, adminUser }) => {
    try {
        if (!userId) throw new Error('User ID is required');

        let user = null;
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(userId).trim());
        if (isUUID) {
            user = await User.findByPk(userId);
        } else {
            const cleanPhone = String(userId).replace(/\D/g, '').slice(-10);
            if (cleanPhone) {
                user = await User.findOne({
                    where: { number: { [Op.like]: `%${cleanPhone}` } }
                });
            }
        }

        if (!user) throw new Error(`User not found: ${userId}`);

        const numAmount = Math.max(0, parseFloat(amount || 0));
        const balType = String(type || 'CR').toUpperCase();
        if (!['DR', 'CR'].includes(balType)) {
            throw new Error('Type must be DR or CR');
        }

        const prevAmount = parseFloat(user.openingBalance || 0);
        const prevType = user.openingBalanceType || 'CR';

        user.openingBalance = numAmount;
        user.openingBalanceType = balType;
        user.isOpeningBalanceSet = true;
        await user.save();

        // Audit log in PartyLedgerEditLog
        try {
            await PartyLedgerEditLog.create({
                userId: user.id,
                orderId: null,
                billNo: 'OPN-BALANCE',
                field: 'Opening Balance',
                oldValue: `₹${prevAmount.toFixed(2)} (${prevType})`,
                newValue: `₹${numAmount.toFixed(2)} (${balType})`,
                reason: `Initial Opening Balance set to ₹${numAmount.toFixed(2)} (${balType})`,
                updatedById: adminUser?.id || null,
                updatedByName: adminUser?.name || 'Admin'
            });
        } catch (logErr) {
            logger.warn(`[PartyLedgerEditLog error on opening balance]: ${logErr.message}`);
        }

        // Force rebuild running ledger with new opening baseline
        const updatedLedger = await syncPartyLedger(user.id, { forceRebuild: true });
        const updatedStatement = await getPartyLedger(user.id, {});

        return {
            success: true,
            message: 'Party opening balance updated successfully',
            user: updatedStatement.user,
            summary: updatedStatement.summary,
            ledgerRows: updatedStatement.ledgerRows
        };
    } catch (error) {
        logger.error(`[updatePartyOpeningBalance Error]: ${error.message}`);
        throw error;
    }
};
