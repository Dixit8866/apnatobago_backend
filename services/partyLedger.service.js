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

/**
 * Reconstruct and synchronize the entire ledger history for a party.
 *
 * @param {string} userId - UUID or phone of customer
 * @param {Object} [options] - { forceRebuild: boolean, transaction: Object }
 * @returns {Promise<Object>} { user, summary, ledgerRows, entries }
 */
export const syncPartyLedger = async (userId, { forceRebuild = false, transaction = null } = {}) => {
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
        const orderOrConds = [{ userId: user.id }];
        const cleanUserPhone = user.number ? String(user.number).replace(/\D/g, '').slice(-10) : '';
        if (cleanUserPhone && cleanUserPhone.length >= 7) {
            orderOrConds.push({ customerNumber: { [Op.like]: `%${cleanUserPhone}` } });
        }

        const orders = await Order.findAll({
            where: { [Op.or]: orderOrConds },
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
            attributes: ['id', 'userId', 'orderId', 'type', 'amount', 'note', 'createdByName', 'createdAt'],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Build Chronological Transactions List
        const chronologicalTransactions = [];

        // 1. Process Orders
        for (const ord of orders) {
            const st = String(ord.orderStatus || '').toLowerCase();
            // Skip cancelled, rejected, and pending orders
            // Business Rule: Party orders only enter Party Ledger / All Date Report once accepted/moved to Packaging or beyond
            if (st.includes('cancel') || st.includes('reject') || st === 'pending') continue;

            const billNo = ord.orderId || String(ord.id).slice(0, 8);
            const fin = calculateOrderFinancials(ord, ord.payments);
            const orderDate = ord.packagingAt || ord.createdAt || new Date();

            const orderPaymentsList = ord.payments || [];
            const orderItemsList = ord.items || [];
            const attachedReturns = ord.returns || [];

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

            // Sales Return on Order
            const returnTotal = attachedReturns.reduce((sum, r) => {
                return sum + parseFloat(r.returnAmount || (parseFloat(r.quantity || 0) * parseFloat(r.price || 0)) || 0);
            }, 0);
            const returnNote = sanitizeReturnNote(attachedReturns.map(r => r.reason));

            // Distinguish payments made at delivery/order time vs subsequent payments:
            let initialCash = 0;
            let initialBank = 0;
            const initialReceivers = [];
            const subsequentPayments = [];

            if (validPayments.length <= 1) {
                // Single or zero payments on this order
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
            } else {
                // Multiple payments: sort chronologically
                validPayments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
                const firstPayTime = new Date(validPayments[0].createdAt).getTime();

                validPayments.forEach((p, pIdx) => {
                    const pTime = new Date(p.createdAt).getTime();
                    const method = String(p.paymentMethod || '').toUpperCase();
                    const pAmt = parseFloat(p.amount || 0);
                    const rName = p.bankAccount?.bankName
                        ? `${p.bankAccount.bankName}${p.bankAccount.accountName ? ` • ${p.bankAccount.accountName}` : ''}`
                        : (p.deliveryBoy?.name ? `Delivery • ${p.deliveryBoy.name}` : null);

                    // First payment or payments made within 2 minutes of the initial payment belong to initial bill settlement
                    if (pIdx === 0 || Math.abs(pTime - firstPayTime) <= 120000) {
                        if (isCashMethod(method)) {
                            initialCash += pAmt;
                        } else if (isBankMethod(method)) {
                            initialBank += pAmt;
                            if (rName) initialReceivers.push(rName);
                        }
                    } else {
                        // Subsequent payments on the same order get their own ledger row with the same billNo
                        subsequentPayments.push({
                            pAmt,
                            method,
                            rName: isBankMethod(method) ? rName : (p.deliveryBoy?.name ? `Delivery • ${p.deliveryBoy.name}` : null),
                            pTime
                        });
                    }
                });
            }

            // Fallback: If marked Paid or has paidAmount without individual OrderPayment record
            if (validPayments.length === 0 && fin.paidAmount > 0) {
                const fallbackMethod = String(ord.paymentMethod || 'CASH').toUpperCase();
                if (isCashMethod(fallbackMethod)) {
                    initialCash = parseFloat(fin.paidAmount);
                } else if (isBankMethod(fallbackMethod)) {
                    initialBank = parseFloat(fin.paidAmount);
                }
            }

            // 1a. Add the primary ORDER invoice row
            chronologicalTransactions.push({
                type: 'ORDER',
                orderId: ord.id,
                dateObj: new Date(orderDate),
                billNo: formattedBillNo,
                sales: salesAmt,
                purchaseCost: parseFloat(purchaseCost.toFixed(2)),
                profit: parseFloat(profit.toFixed(2)),
                cash: parseFloat(initialCash.toFixed(2)),
                bank: parseFloat(initialBank.toFixed(2)),
                bankReceiver: initialReceivers.length > 0 ? Array.from(new Set(initialReceivers)).join(', ') : '-',
                kupan: parseFloat(couponDiscount.toFixed(2)),
                returnVal: parseFloat(returnTotal.toFixed(2)),
                returnNote: returnNote,
                sortTime: orderTimestamp
            });

            // 1b. Add separate rows for any SUBSEQUENT payments on this same bill
            subsequentPayments.forEach((sp, spIdx) => {
                chronologicalTransactions.push({
                    type: 'ORDER_PAYMENT',
                    orderId: ord.id,
                    dateObj: new Date(sp.pTime),
                    billNo: formattedBillNo, // Bill number stays the same!
                    sales: 0, // Sales is 0 for payment receipt
                    purchaseCost: 0,
                    profit: 0,
                    cash: isCashMethod(sp.method) ? parseFloat(sp.pAmt.toFixed(2)) : 0,
                    bank: isBankMethod(sp.method) ? parseFloat(sp.pAmt.toFixed(2)) : 0,
                    bankReceiver: sp.rName || '-',
                    kupan: 0,
                    returnVal: 0,
                    returnNote: '-', // Never put return note on payment!
                    sortTime: sp.pTime + 1 + spIdx
                });
            });
        }

        // 2. Process Standalone Sales Returns
        standaloneReturns.forEach((ret, rIdx) => {
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

        // Sort all transactions chronologically
        chronologicalTransactions.sort((a, b) => a.sortTime - b.sortTime);

        // Build continuous Running Ledger Rows
        let runningBalance = 0;
        const allBuiltRows = chronologicalTransactions.map((tx, idx) => {
            const dt = formatLedgerDateTime(tx.dateObj);
            const openingBalance = runningBalance;
            const totalAmount = parseFloat((openingBalance + tx.sales).toFixed(2));
            const creditsTotal = tx.cash + tx.bank + tx.kupan + tx.returnVal;
            const closingBalance = parseFloat((totalAmount - creditsTotal).toFixed(2));

            runningBalance = closingBalance;

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
                returnNote: tx.returnNote,
                closingBalance: closingBalance
            };
        });

        // Synchronize User Model closingBalance as single source of truth
        const latestClosingBalance = runningBalance;

        if (user) {
            try {
                user.closingBalance = latestClosingBalance;
                await user.save({ transaction });
            } catch (uErr) {
                logger.warn(`[syncPartyLedger User update warning]: ${uErr.message}`);
            }
        }

        // Synchronize Order dueAmount so running ledger and order records remain 100% consistent
        const orderRows = allBuiltRows.filter(r => r.orderId);
        if (orderRows.length > 0) {
            const lastOrderRow = orderRows[orderRows.length - 1];
            for (const r of orderRows) {
                try {
                    const isLast = r.orderId === lastOrderRow.orderId;
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
                balanceType: latestClosingBalance > 0 ? 'DUE' : (latestClosingBalance < 0 ? 'JAMA' : 'CLEAR')
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

        let filteredRows = allRows;
        let periodOpeningBalance = 0;

        if (startTimestamp || endTimestamp) {
            const priorRows = allRows.filter(r => startTimestamp ? r.dateObj.getTime() < startTimestamp : false);
            if (priorRows.length > 0) {
                periodOpeningBalance = priorRows[priorRows.length - 1].closingBalance;
            } else if (allRows.length > 0) {
                periodOpeningBalance = allRows[0].openingBalance;
            }

            filteredRows = allRows.filter(r => {
                const t = r.dateObj.getTime();
                if (startTimestamp && t < startTimestamp) return false;
                if (endTimestamp && t > endTimestamp) return false;
                return true;
            });
        } else if (allRows.length > 0) {
            periodOpeningBalance = allRows[0].openingBalance;
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

        // Compute Summary Totals for UI Cards
        const totals = filteredRows.reduce((acc, r) => {
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

        const periodClosingBalance = filteredRows.length > 0
            ? filteredRows[filteredRows.length - 1].closingBalance
            : periodOpeningBalance;

        const latestRowOpening = filteredRows.length > 0
            ? filteredRows[filteredRows.length - 1].openingBalance
            : periodOpeningBalance;

        return {
            user: synced.user,
            summary: {
                openingBalance: parseFloat(latestRowOpening.toFixed(2)),
                periodSales: parseFloat(totals.periodSales.toFixed(2)),
                totalAmount: parseFloat((latestRowOpening + totals.periodSales).toFixed(2)),
                purchaseCost: parseFloat(totals.purchaseCost.toFixed(2)),
                profit: parseFloat(totals.profit.toFixed(2)),
                cash: parseFloat(totals.cash.toFixed(2)),
                bank: parseFloat(totals.bank.toFixed(2)),
                kupan: parseFloat(totals.kupan.toFixed(2)),
                returnVal: parseFloat(totals.returnVal.toFixed(2)),
                closingBalance: parseFloat(synced.closingBalance.toFixed(2)),
                periodClosingBalance: parseFloat(periodClosingBalance.toFixed(2)),
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
