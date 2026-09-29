import { Op } from 'sequelize';
import {
    Order,
    OrderPayment,
    User,
    BusinessProfile,
    SalesReturn,
    PartyBalanceLog,
    PartyLedger,
    BankSetting,
    DeliveryBoy
} from '../models/index.js';
import { calculateOrderFinancials } from './financialSettlement.service.js';
import logger from '../logger/apiLogger.js';

/**
 * ==============================================================================
 * CENTRALIZED PARTY ACCOUNTING & DOUBLE-ENTRY LEDGER SERVICE
 * ==============================================================================
 * Manages Party / Customer Ledger (ખાતાવહી):
 * - DEBIT (ઉધાર): Bill Generation, Invoices, Debit Notes
 * - CREDIT (જમા): Cash, Online Bank, Cheque, Coupons, Sales Return, Advance Jama
 * - RUNNING BALANCE: Progressive outstanding dues or advance balance
 */

/**
 * Reconstruct and synchronize the entire ledger history for a party.
 * Idempotent: checks existing vouchers and reconciles chronological balance.
 *
 * @param {string} userId - UUID of customer
 * @param {Object} [options] - { forceRebuild: boolean, transaction: Object }
 * @returns {Promise<Object>} { user, summary, entries }
 */
export const syncPartyLedger = async (userId, { forceRebuild = false, transaction = null } = {}) => {
    try {
        if (!userId) throw new Error('User ID is required for party ledger sync');

        const user = await User.findByPk(userId, {
            include: [{ model: BusinessProfile, as: 'businessProfile' }],
            transaction
        });

        if (!user) throw new Error(`User not found: ${userId}`);

        // Fetch all non-cancelled orders for this party
        const orders = await Order.findAll({
            where: { userId },
            include: [
                {
                    model: OrderPayment,
                    as: 'payments',
                    required: false,
                    include: [{ model: BankSetting, as: 'bankAccount', attributes: ['id', 'bankName', 'accountNumber'] }]
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    required: false
                }
            ],
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Fetch manual balance logs (adjustments, direct party payments, opening dues)
        const balanceLogs = await PartyBalanceLog.findAll({
            where: { userId },
            order: [['createdAt', 'ASC']],
            transaction
        });

        // Build atomic timeline events
        const timelineEvents = [];

        // 1. Process Orders & attached payments
        for (const ord of orders) {
            const st = String(ord.orderStatus || '').toLowerCase();
            if (st.includes('cancel') || st.includes('reject')) continue;

            const billNo = ord.orderId || String(ord.id).slice(0, 8);
            const fin = calculateOrderFinancials(ord, ord.payments);
            const orderDate = ord.createdAt || new Date();

            // Total Gross Bill Amount -> DEBIT (ઉધાર)
            const grossBill = fin.totalAmount || 0;
            if (grossBill > 0) {
                timelineEvents.push({
                    type: 'SALES_INVOICE',
                    voucherNo: `BILL-${billNo}`,
                    date: orderDate,
                    particulars: `Sales Bill #${billNo} (${ord.orderStatus})`,
                    debit: grossBill,
                    credit: 0,
                    paymentMethod: 'BILL',
                    bankName: null,
                    orderId: ord.id,
                    referenceId: `ORD-BILL-${ord.id}`,
                    note: `Order Status: ${ord.orderStatus}`,
                    sortTime: new Date(orderDate).getTime()
                });
            }

            // Coupon Discount -> CREDIT (જમા)
            if (fin.couponDiscount > 0) {
                timelineEvents.push({
                    type: 'COUPON',
                    voucherNo: `CPN-${billNo}`,
                    date: orderDate,
                    particulars: `Coupon Discount Applied (Bill #${billNo})`,
                    debit: 0,
                    credit: fin.couponDiscount,
                    paymentMethod: 'COUPON',
                    bankName: null,
                    orderId: ord.id,
                    referenceId: `ORD-CPN-${ord.id}`,
                    note: ord.discountType || 'Coupon Discount',
                    sortTime: new Date(orderDate).getTime() + 10 // right after bill
                });
            }

            // Sales Return on Order -> CREDIT (જમા)
            const attachedReturns = ord.returns || ord.salesReturns || [];
            let totalReturnAmt = 0;
            attachedReturns.forEach((ret, rIdx) => {
                const retAmt = parseFloat(ret.returnAmount || (ret.quantity * (ret.price || 0)) || 0);
                if (retAmt > 0) {
                    totalReturnAmt += retAmt;
                    timelineEvents.push({
                        type: 'SALES_RETURN',
                        voucherNo: `SR-${billNo}-${rIdx + 1}`,
                        date: ret.createdAt || orderDate,
                        particulars: `Sales Return Credit (Bill #${billNo})`,
                        debit: 0,
                        credit: retAmt,
                        paymentMethod: 'SALES_RETURN',
                        bankName: null,
                        orderId: ord.id,
                        referenceId: `ORD-RET-${ret.id || `${ord.id}-${rIdx}`}`,
                        note: ret.reason || 'Goods returned',
                        sortTime: new Date(ret.createdAt || orderDate).getTime() + 20
                    });
                }
            });

            // Payments recorded on this order -> CREDIT (જમા)
            const payments = ord.payments || [];
            payments.forEach((p, pIdx) => {
                const method = String(p.paymentMethod || '').toUpperCase();
                const pAmt = parseFloat(p.amount || 0);
                const pCash = parseFloat(p.cashAmount || 0);
                const pOnline = parseFloat(p.onlineAmount || 0);
                const bank = p.bankAccount?.bankName || p.bankSetting?.bankName || null;
                const pDate = p.createdAt || orderDate;

                if (method === 'CREDIT') {
                    // Credit method means remaining was put on Credit / Due (already reflected in debit - payments)
                    return;
                }

                if (pCash > 0 && pOnline > 0) {
                    timelineEvents.push({
                        type: 'PAYMENT',
                        voucherNo: `RCP-${billNo}-CASH`,
                        date: pDate,
                        particulars: `Payment Received (Cash - Bill #${billNo})`,
                        debit: 0,
                        credit: pCash,
                        paymentMethod: 'CASH',
                        bankName: null,
                        orderId: ord.id,
                        referenceId: `PAY-SPLIT-CASH-${p.id}`,
                        note: p.notes || 'Cash collection',
                        sortTime: new Date(pDate).getTime() + 30 + pIdx
                    });

                    timelineEvents.push({
                        type: 'PAYMENT',
                        voucherNo: `RCP-${billNo}-ONLINE`,
                        date: pDate,
                        particulars: `Payment Received (Online Bank - Bill #${billNo}${bank ? ` via ${bank}` : ''})`,
                        debit: 0,
                        credit: pOnline,
                        paymentMethod: 'ONLINE',
                        bankName: bank,
                        orderId: ord.id,
                        referenceId: `PAY-SPLIT-ONLINE-${p.id}`,
                        note: p.notes || (p.transactionId ? `Txn: ${p.transactionId}` : 'Bank transfer'),
                        sortTime: new Date(pDate).getTime() + 31 + pIdx
                    });
                } else if (pAmt > 0) {
                    const isCash = method === 'CASH' || pCash > 0;
                    timelineEvents.push({
                        type: 'PAYMENT',
                        voucherNo: `RCP-${billNo}-${pIdx + 1}`,
                        date: pDate,
                        particulars: `Payment Received (${isCash ? 'Cash' : `Online Bank${bank ? ` - ${bank}` : ''}`} - Bill #${billNo})`,
                        debit: 0,
                        credit: pAmt,
                        paymentMethod: isCash ? 'CASH' : 'ONLINE',
                        bankName: bank,
                        orderId: ord.id,
                        referenceId: `PAY-${p.id}`,
                        note: p.notes || (p.transactionId ? `Txn: ${p.transactionId}` : null),
                        sortTime: new Date(pDate).getTime() + 30 + pIdx
                    });
                }
            });

            // Fallback for orders marked Paid or with paidAmount but no separate OrderPayment record
            if (payments.length === 0 && fin.paidAmount > 0) {
                const paidVal = parseFloat(fin.paidAmount);
                timelineEvents.push({
                    type: 'PAYMENT',
                    voucherNo: `RCP-${billNo}`,
                    date: orderDate,
                    particulars: `Payment Received (Settled Bill #${billNo})`,
                    debit: 0,
                    credit: paidVal,
                    paymentMethod: ord.paymentMethod || 'CASH',
                    bankName: null,
                    orderId: ord.id,
                    referenceId: `ORD-PAID-${ord.id}`,
                    note: `Settled payment for order #${billNo}`,
                    sortTime: new Date(orderDate).getTime() + 30
                });
            }
        }

        // 2. Process Independent Party Balance Logs (Adjustments / Standalone Payments not tied to orders)
        for (const log of balanceLogs) {
            // If log has an orderId that is already processed in orders list, avoid double counting
            if (log.orderId && orders.some(o => o.id === log.orderId)) {
                continue;
            }

            const logAmt = parseFloat(log.amount || 0);
            if (logAmt <= 0) continue;

            const logType = String(log.type || '').toUpperCase();
            const logDate = log.createdAt || new Date();

            if (logType === 'JAMA' || logType === 'PAYMENT') {
                // Customer gave money / Advance Jama / Direct Settlement -> CREDIT (જમા)
                timelineEvents.push({
                    type: 'ADJUSTMENT',
                    voucherNo: `ADJ-CR-${String(log.id).slice(0, 8)}`,
                    date: logDate,
                    particulars: log.note || 'Direct Payment / Advance Jama Received',
                    debit: 0,
                    credit: logAmt,
                    paymentMethod: 'CASH',
                    bankName: null,
                    orderId: null,
                    referenceId: `LOG-${log.id}`,
                    note: log.note || 'Manual Credit Balance Adjustment',
                    createdByName: log.createdByName || 'Admin',
                    sortTime: new Date(logDate).getTime()
                });
            } else if (logType === 'BAKI') {
                // Past due added / Manual Debit -> DEBIT (ઉધાર)
                timelineEvents.push({
                    type: 'ADJUSTMENT',
                    voucherNo: `ADJ-DR-${String(log.id).slice(0, 8)}`,
                    date: logDate,
                    particulars: log.note || 'Previous Opening Balance / Due Added',
                    debit: logAmt,
                    credit: 0,
                    paymentMethod: 'ADJUSTMENT',
                    bankName: null,
                    orderId: null,
                    referenceId: `LOG-${log.id}`,
                    note: log.note || 'Manual Debit Balance Adjustment',
                    createdByName: log.createdByName || 'Admin',
                    sortTime: new Date(logDate).getTime()
                });
            }
        }

        // Sort events chronologically
        timelineEvents.sort((a, b) => a.sortTime - b.sortTime);

        // Pre-compute valid order IDs from actual user orders to protect DB foreign key
        const validOrderIds = new Set((orders || []).map(o => o.id));

        // Compute running balance step-by-step
        let currentRunningBalance = 0;
        const processedEntries = timelineEvents.map(evt => {
            const debit = parseFloat(evt.debit || 0);
            const credit = parseFloat(evt.credit || 0);
            currentRunningBalance = parseFloat((currentRunningBalance + debit - credit).toFixed(2));

            return {
                userId,
                orderId: (evt.orderId && validOrderIds.has(evt.orderId)) ? evt.orderId : null,
                voucherNo: evt.voucherNo,
                voucherType: evt.type,
                date: evt.date,
                particulars: evt.particulars,
                debit: debit.toFixed(2),
                credit: credit.toFixed(2),
                runningBalance: currentRunningBalance.toFixed(2),
                paymentMethod: evt.paymentMethod || null,
                bankName: evt.bankName || null,
                referenceId: evt.referenceId || null,
                note: evt.note || null,
                createdByName: evt.createdByName || 'System'
            };
        });

        // Persist to `party_ledgers` table
        if (forceRebuild) {
            await PartyLedger.destroy({ where: { userId }, transaction });
            if (processedEntries.length > 0) {
                await PartyLedger.bulkCreate(processedEntries, { transaction });
            }
        } else {
            // Upsert / idempotent save by referenceId
            for (const entry of processedEntries) {
                if (entry.referenceId) {
                    const existing = await PartyLedger.findOne({
                        where: { userId, referenceId: entry.referenceId },
                        transaction
                    });
                    if (existing) {
                        await existing.update(entry, { transaction });
                    } else {
                        await PartyLedger.create(entry, { transaction });
                    }
                } else {
                    await PartyLedger.create(entry, { transaction });
                }
            }
        }

        // Calculate Totals
        const totalDebit = processedEntries.reduce((sum, e) => sum + parseFloat(e.debit || 0), 0);
        const totalCredit = processedEntries.reduce((sum, e) => sum + parseFloat(e.credit || 0), 0);
        const netOutstandingDue = Math.max(0, currentRunningBalance);
        const advanceJama = currentRunningBalance < 0 ? Math.abs(currentRunningBalance) : 0;

        return {
            user: {
                id: user.id,
                fullname: user.fullname,
                shopName: user.businessProfile?.businessName || user.fullname,
                phone: user.number,
                area: user.businessProfile?.area || user.city || '',
                address: user.businessProfile?.address || '',
                creditline: parseFloat(user.creditline || 0),
                currentDue: netOutstandingDue,
                advanceJama: advanceJama,
                balanceType: currentRunningBalance > 0 ? 'DUE' : (currentRunningBalance < 0 ? 'JAMA' : 'CLEAR')
            },
            summary: {
                totalBilled: parseFloat(totalDebit.toFixed(2)),
                totalReceived: parseFloat(totalCredit.toFixed(2)),
                currentBalance: parseFloat(currentRunningBalance.toFixed(2)),
                totalDue: parseFloat(netOutstandingDue.toFixed(2)),
                totalAdvanceJama: parseFloat(advanceJama.toFixed(2)),
                totalOrdersCount: orders.length,
                totalEntriesCount: processedEntries.length
            },
            entries: processedEntries
        };
    } catch (error) {
        logger.error(`[syncPartyLedger Error for userId ${userId}]: ${error.message}`);
        throw error;
    }
};

/**
 * Get Party Ledger with date filtering, search, and pagination.
 *
 * @param {string} userId - UUID of customer
 * @param {Object} query - { startDate, endDate, search, limit, page, refresh }
 * @returns {Promise<Object>}
 */
export const getPartyLedger = async (userId, query = {}) => {
    try {
        const { startDate, endDate, search, limit = 500, refresh = false } = query;

        // Auto-sync if refresh requested or check if table has records
        const existingCount = await PartyLedger.count({ where: { userId } });
        if (existingCount === 0 || refresh === 'true' || refresh === true) {
            await syncPartyLedger(userId, { forceRebuild: true });
        }

        const user = await User.findByPk(userId, {
            include: [{ model: BusinessProfile, as: 'businessProfile' }]
        });

        if (!user) throw new Error('User not found');

        // Build query conditions
        const where = { userId };

        if (startDate && endDate) {
            where.date = {
                [Op.between]: [
                    new Date(`${startDate}T00:00:00.000Z`),
                    new Date(`${endDate}T23:59:59.999Z`)
                ]
            };
        } else if (startDate) {
            where.date = { [Op.gte]: new Date(`${startDate}T00:00:00.000Z`) };
        } else if (endDate) {
            where.date = { [Op.lte]: new Date(`${endDate}T23:59:59.999Z`) };
        }

        if (search && search.trim()) {
            const s = search.trim();
            where[Op.or] = [
                { voucherNo: { [Op.iLike]: `%${s}%` } },
                { particulars: { [Op.iLike]: `%${s}%` } },
                { paymentMethod: { [Op.iLike]: `%${s}%` } },
                { note: { [Op.iLike]: `%${s}%` } }
            ];
        }

        // Calculate Opening Balance if startDate is filtered
        let openingBalance = 0;
        if (startDate) {
            const priorEntries = await PartyLedger.findAll({
                where: {
                    userId,
                    date: { [Op.lt]: new Date(`${startDate}T00:00:00.000Z`) }
                },
                attributes: ['debit', 'credit']
            });

            const priorDebit = priorEntries.reduce((acc, r) => acc + parseFloat(r.debit || 0), 0);
            const priorCredit = priorEntries.reduce((acc, r) => acc + parseFloat(r.credit || 0), 0);
            openingBalance = priorDebit - priorCredit;
        }

        // Fetch records for this view
        const entries = await PartyLedger.findAll({
            where,
            order: [['date', 'ASC'], ['createdAt', 'ASC']],
            limit: parseInt(limit, 10) || 500
        });

        // Compute totals for this filtered range
        const periodDebit = entries.reduce((acc, r) => acc + parseFloat(r.debit || 0), 0);
        const periodCredit = entries.reduce((acc, r) => acc + parseFloat(r.credit || 0), 0);
        const periodClosingBalance = openingBalance + periodDebit - periodCredit;

        // Compute overall lifetime balance for party header
        const allEntries = await PartyLedger.findAll({
            where: { userId },
            attributes: ['debit', 'credit']
        });
        const lifetimeDebit = allEntries.reduce((acc, r) => acc + parseFloat(r.debit || 0), 0);
        const lifetimeCredit = allEntries.reduce((acc, r) => acc + parseFloat(r.credit || 0), 0);
        const lifetimeBalance = lifetimeDebit - lifetimeCredit;

        return {
            user: {
                id: user.id,
                fullname: user.fullname,
                shopName: user.businessProfile?.businessName || user.fullname,
                phone: user.number,
                area: user.businessProfile?.area || user.city || '',
                address: user.businessProfile?.address || '',
                creditline: parseFloat(user.creditline || 0),
                currentDue: Math.max(0, lifetimeBalance),
                advanceJama: lifetimeBalance < 0 ? Math.abs(lifetimeBalance) : 0,
                balanceType: lifetimeBalance > 0 ? 'DUE' : (lifetimeBalance < 0 ? 'JAMA' : 'CLEAR')
            },
            summary: {
                openingBalance: parseFloat(openingBalance.toFixed(2)),
                totalDebit: parseFloat(periodDebit.toFixed(2)),
                totalCredit: parseFloat(periodCredit.toFixed(2)),
                closingBalance: parseFloat(periodClosingBalance.toFixed(2)),
                lifetimeTotalBilled: parseFloat(lifetimeDebit.toFixed(2)),
                lifetimeTotalReceived: parseFloat(lifetimeCredit.toFixed(2)),
                lifetimeNetDue: parseFloat(Math.max(0, lifetimeBalance).toFixed(2)),
                lifetimeAdvanceJama: parseFloat((lifetimeBalance < 0 ? Math.abs(lifetimeBalance) : 0).toFixed(2)),
                count: entries.length
            },
            entries
        };
    } catch (error) {
        logger.error(`[getPartyLedger Error]: ${error.message}`);
        throw error;
    }
};

/**
 * Record a manual debit/credit ledger adjustment for a party.
 *
 * @param {Object} data
 * @returns {Promise<Object>}
 */
export const recordManualPartyEntry = async ({
    userId,
    entryType, // 'DEBIT' | 'CREDIT'
    amount,
    date = new Date(),
    particulars,
    paymentMethod = 'CASH',
    note = null,
    createdById = null,
    createdByName = 'Admin'
}) => {
    try {
        const parsedAmt = parseFloat(amount || 0);
        if (parsedAmt <= 0) throw new Error('Amount must be greater than 0');

        const isDebit = entryType.toUpperCase() === 'DEBIT';
        const debit = isDebit ? parsedAmt : 0;
        const credit = !isDebit ? parsedAmt : 0;

        // Fetch last balance
        const lastEntry = await PartyLedger.findOne({
            where: { userId },
            order: [['date', 'DESC'], ['createdAt', 'DESC']]
        });

        const prevBal = lastEntry ? parseFloat(lastEntry.runningBalance || 0) : 0;
        const newBal = prevBal + debit - credit;

        const voucherNo = `${isDebit ? 'DR' : 'CR'}-${Date.now().toString().slice(-6)}`;

        const entry = await PartyLedger.create({
            userId,
            voucherNo,
            voucherType: isDebit ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
            date,
            particulars: particulars || (isDebit ? 'Manual Debit Adjustment' : 'Manual Credit Adjustment'),
            debit,
            credit,
            runningBalance: newBal,
            paymentMethod,
            note,
            createdById,
            createdByName
        });

        // Also record in PartyBalanceLog for system consistency
        await PartyBalanceLog.create({
            userId,
            type: isDebit ? 'BAKI' : 'JAMA',
            amount: parsedAmt,
            previousBalance: prevBal,
            newBalance: newBal,
            note: particulars || note || 'Manual Ledger Entry',
            createdById,
            createdByName
        });

        return entry;
    } catch (error) {
        logger.error(`[recordManualPartyEntry Error]: ${error.message}`);
        throw error;
    }
};
