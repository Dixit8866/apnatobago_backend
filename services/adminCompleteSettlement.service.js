import sequelize from '../config/db.js';
import {
    Order,
    User,
    OrderPayment,
    OrderAssignment,
    DeliveryBoy,
    SalesReturn,
    BankSetting,
    PartyBalanceLog,
    BusinessProfile
} from '../models/index.js';
import logger from '../logger/apiLogger.js';
import { getCustomerCreditFinancials, syncPartyDeliveryNotice } from './financialSettlement.service.js';
import { syncPartyLedger, getLedgerBillReturns } from './partyLedger.service.js';
import { getUserPreviousBillsService, sendDeliveredNotification } from './delivery/deliveryOrder.service.js';
import { broadcastOrderStatusChanged, broadcastUserUpdated } from './socketEvent.service.js';

/**
 * ==============================================================================
 * ADMIN COMPLETE & SETTLE SERVICE
 * ==============================================================================
 * Admin completes a Shipping order from the Customer Orders list (e.g. no rider assigned)
 * and settles its bill the same way the delivery app's complete-settle does:
 * Cash, Online (bank account), Credit (capped at available credit), product/volume-wise
 * Sales Return from the party's last delivered bills, Kupan and a note.
 * The order is completed only when the bill is fully accounted (remaining = 0).
 */

const DELIVERED_STATUSES = ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'];
const SETTLE_METHODS = ['CASH', 'ONLINE', 'CREDIT', 'SALES_RETURN'];

const round2 = (v) => Math.round((parseFloat(v) || 0) * 100) / 100;
const returnAmountOf = (r) => parseFloat(r.returnAmount || (parseFloat(r.quantity || 0) * parseFloat(r.price || 0)) || 0);

// Party's account before this bill, from the Party Ledger (getPartyCurrentDue via getCustomerCreditFinancials).
// Credit entered in the popup = party's total baki after this bill (old due included, as Party Billing records it):
// the old due can always be carried, new credit only up to the available credit.
const getPartyAccount = async (order, transaction = null) => {
    if (!order.userId) {
        return { baseCreditLimit: 0, pastDue: 0, advanceJama: 0, openingBalance: 0, availableCredit: 0, maxCredit: 0, blockcredit: false };
    }
    const fin = await getCustomerCreditFinancials({ userId: order.userId, excludeOrderId: order.id, transaction });
    const pastDue = round2(fin.totalPendingDue ?? fin.usedCredit);
    const advanceJama = round2(fin.advanceJama);
    const availableCredit = round2(fin.availableCredit);
    const openingBalance = round2(pastDue - advanceJama);
    return {
        baseCreditLimit: round2(fin.baseCreditLimit),
        pastDue,
        advanceJama,
        openingBalance,
        availableCredit,
        maxCredit: Math.max(Math.max(0, openingBalance), round2(pastDue + availableCredit - advanceJama)),
        blockcredit: Boolean(fin.blockcredit)
    };
};

// Party's last delivered bills (latest 5) with returnable items and their volume options
const getReturnableBills = async (order) => {
    if (!order.userId) return [];
    const prev = await getUserPreviousBillsService({ userId: order.userId, currentOrderId: order.id });
    return (prev?.previousBills || []).filter(b => DELIVERED_STATUSES.includes(b.orderStatus));
};

/**
 * Data for the admin Complete & Settle popup
 */
export const getAdminCompleteSettleInfoService = async ({ orderId }) => {
    const order = await Order.findByPk(orderId, {
        include: [
            {
                model: User,
                as: 'user',
                attributes: ['id', 'fullname', 'number'],
                include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName'] }]
            },
            {
                model: OrderAssignment,
                as: 'assignment',
                required: false,
                include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name'] }]
            }
        ]
    });
    if (!order) return null;

    // Returns the Party Ledger already shows on this bill (counted in this bill's settlement)
    const ledgerBill = await getLedgerBillReturns(order.id);
    const alreadyReturned = round2(ledgerBill.returns.reduce((sum, r) => sum + returnAmountOf(r), 0));

    const account = await getPartyAccount(order);

    const previousBills = await getReturnableBills(order);

    return {
        order: {
            id: order.id,
            orderId: order.orderId,
            orderStatus: order.orderStatus,
            userId: order.userId,
            totalAmount: round2(order.totalAmount),
            couponDiscount: round2(order.couponDiscount),
            partyName: order.user?.businessProfile?.shopName || order.customerName || order.user?.fullname || 'Party',
            partyPhone: order.user?.number || order.customerNumber || '',
            deliveryBoyName: order.assignment?.deliveryBoy?.name || null
        },
        alreadyReturned,
        credit: account,
        previousBills
    };
};

/**
 * Complete a Shipping order from admin and settle its bill
 */
export const adminCompleteOrderSettlementService = async ({ orderId, body = {}, actorName = 'Admin' }) => {
    const cash = round2(body.cashAmount);
    const online = round2(body.onlineAmount);
    const credit = round2(body.creditAmount);
    const coupon = round2(body.couponAmount);
    const bankSettingId = body.bankSettingId || null;
    const note = String(body.note || '').trim();
    // Admin confirmed taking more than the account total: the extra stays as the party's jama in the ledger
    const acceptExtra = body.acceptExtra === true || body.acceptExtra === 'true';
    const returnInput = Array.isArray(body.salesReturnItems) ? body.salesReturnItems : [];

    if ([cash, online, credit, coupon].some(v => v < 0)) {
        return { error: 'રકમ માઇનસ (-) ન હોઈ શકે.' };
    }
    if (online > 0 && !bankSettingId) {
        return { error: 'Online રકમ માટે બેંક ખાતું પસંદ કરો.' };
    }

    const t = await sequelize.transaction();
    try {
        const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            return { notFound: true };
        }
        if (order.orderStatus !== 'Shipping') {
            await t.rollback();
            return { error: `આ ઓર્ડર ${order.orderStatus} માં છે. ફક્ત Shipping ઓર્ડર જ અહીંથી Complete થઈ શકે.` };
        }

        let bank = null;
        if (online > 0) {
            bank = await BankSetting.findByPk(bankSettingId, { transaction: t });
            if (!bank) {
                await t.rollback();
                return { error: 'પસંદ કરેલ બેંક ખાતું મળ્યું નથી.' };
            }
        }

        if ((credit > 0 || returnInput.length > 0) && !order.userId) {
            await t.rollback();
            return { error: 'આ ઓર્ડર કોઈ પાર્ટી ખાતા સાથે જોડાયેલ નથી, Credit / Sales Return થઈ શકે નહીં.' };
        }

        // ── Sales Return lines: price & volume always taken from the source bill item (server side) ──
        const returnLines = [];
        if (returnInput.length > 0) {
            const bills = await getReturnableBills(order);
            const usedUnitsByItem = new Map();

            for (const r of returnInput) {
                const qty = round2(r.quantity);
                if (qty <= 0) continue;

                const bill = bills.find(b => String(b.id) === String(r.sourceOrderId));
                const item = bill?.items?.find(i => String(i.id) === String(r.orderItemId));
                const option = item?.productVolumes?.find(v =>
                    String(v.variantId) === String(r.variantId) && Number(v.unitsPerPack) === Number(r.unitsPerPack)
                );
                if (!bill || !item || !option) {
                    await t.rollback();
                    return { error: 'Sales return નું બિલ / પ્રોડક્ટ / વોલ્યુમ મળ્યું નથી. પોપઅપ ફરી ખોલો.' };
                }

                // Returned units must not exceed what is still returnable on that bill item
                const itemKey = `${bill.id}:${item.id}`;
                const usedUnits = (usedUnitsByItem.get(itemKey) || 0) + qty * Number(option.unitsPerPack || 1);
                const returnableUnits = parseFloat(item.quantity || 0) * Number(item.packUnits || 1);
                if (usedUnits > returnableUnits + 0.001) {
                    await t.rollback();
                    return { error: `${item.productName} (બિલ #${bill.billNo}): પરત જથ્થો બાકી જથ્થા કરતાં વધુ છે.` };
                }
                usedUnitsByItem.set(itemKey, usedUnits);

                const price = round2(option.price);
                // Loose unit of a pack that has no own unit variant: quantity is in base units ([Inner] prefix for stock restore)
                const isLooseUnit = String(option.variantId) === String(item.variantId)
                    && Number(option.unitsPerPack) === 1
                    && Number(item.packUnits || 1) !== 1;

                returnLines.push({
                    sourceOrder: bill,
                    productId: item.productId,
                    variantId: option.variantId,
                    volumeId: option.volumeId || null,
                    quantity: qty,
                    price,
                    returnAmount: round2(qty * price),
                    reason: isLooseUnit ? '[Inner]' : null
                });
            }
        }

        const billTotal = round2(order.totalAmount);
        if (coupon > billTotal) {
            await t.rollback();
            return { error: 'કુપન રકમ બિલ કરતાં વધુ ન હોઈ શકે.' };
        }

        const ledgerBill = await getLedgerBillReturns(order.id, { transaction: t });
        const alreadyReturned = round2(ledgerBill.returns.reduce((sum, r) => sum + returnAmountOf(r), 0));
        const newReturnTotal = round2(returnLines.reduce((sum, l) => sum + l.returnAmount, 0));
        const totalReturn = round2(alreadyReturned + newReturnTotal);

        // Party's whole account must be accounted: Old Due + Bill - Kupan - Return - Cash - Online - Credit = 0
        const account = await getPartyAccount(order, t);
        const remaining = round2(account.openingBalance + billTotal - coupon - totalReturn - cash - online - credit);
        if (remaining > 0.009) {
            await t.rollback();
            return { error: `હજુ ₹${remaining.toFixed(2)} બાકી છે (જૂની બાકી + બિલ). બાકી 0 થાય તો જ ઓર્ડર Complete થશે.` };
        }
        const extraAmount = remaining < -0.009 ? round2(-remaining) : 0;
        if (extraAmount > 0 && credit > 0) {
            await t.rollback();
            return { error: `ભરેલ રકમ લેવાની રકમ કરતાં ₹${extraAmount.toFixed(2)} વધુ છે, ત્યારે Credit ન નાખી શકાય. Credit 0 કરો.` };
        }
        if (extraAmount > 0 && !acceptExtra) {
            await t.rollback();
            return { error: `ભરેલ રકમ લેવાની રકમ કરતાં ₹${extraAmount.toFixed(2)} વધુ છે.` };
        }

        if (credit > account.maxCredit + 0.009) {
            await t.rollback();
            return { error: `Credit મહત્તમ ₹${account.maxCredit.toFixed(2)} સુધી જ નાખી શકાય (જૂની બાકી ₹${Math.max(0, account.openingBalance).toFixed(2)} + ઉપલબ્ધ ₹${account.availableCredit.toFixed(2)}).` };
        }

        let user = null;
        if (order.userId) {
            user = await User.findByPk(order.userId, { transaction: t });
        }

        // ── Sales Returns: linked to the bill the goods came from, dated at this bill's ledger time
        // so the Party Ledger shows them on this bill (counted once). Pending → stock restored on approval.
        const billTimeMs = ledgerBill.billTime ? new Date(ledgerBill.billTime).getTime() : null;
        for (const line of returnLines) {
            const src = await Order.findByPk(line.sourceOrder.id, { attributes: ['id', 'createdAt', 'packagingAt'], transaction: t });
            const srcTimeMs = src ? new Date(src.packagingAt || src.createdAt).getTime() : null;
            const linkOrderId = src && (billTimeMs === null || srcTimeMs <= billTimeMs) ? src.id : order.id;

            await SalesReturn.create({
                orderId: linkOrderId,
                userId: order.userId,
                deliveryBoyId: null,
                productId: line.productId,
                variantId: line.variantId,
                volumeId: line.volumeId,
                quantity: line.quantity,
                price: line.price,
                returnAmount: line.returnAmount,
                reason: line.reason,
                condition: 'GOOD',
                status: 'Pending',
                creditProcessed: true,
                ...(ledgerBill.billTime ? { createdAt: ledgerBill.billTime } : {})
            }, { transaction: t });
        }

        const pendingCreditReturnIds = ledgerBill.returns.filter(r => r.creditProcessed === false).map(r => r.id);
        if (pendingCreditReturnIds.length > 0) {
            await SalesReturn.update({ creditProcessed: true }, { where: { id: pendingCreditReturnIds }, transaction: t });
        }

        // ── Payments on this bill (collected by admin, so already submitted) ──
        await OrderPayment.destroy({
            where: { orderId: order.id, paymentMethod: SETTLE_METHODS },
            transaction: t
        });

        const now = new Date();
        const paymentBase = { orderId: order.id, deliveryBoyId: null, isSubmitted: true, submittedAt: now };
        const extraNote = extraAmount > 0 ? ` — ₹${extraAmount.toFixed(2)} extra kept as party jama` : '';
        if (cash > 0) {
            await OrderPayment.create({ ...paymentBase, amount: cash, paymentMethod: 'CASH', notes: `Cash collected (Admin Complete)${extraNote}` }, { transaction: t });
        }
        if (online > 0) {
            await OrderPayment.create({
                ...paymentBase,
                amount: online,
                paymentMethod: 'ONLINE',
                bankSettingId: bank.id,
                onlineType: 'Bank Account',
                notes: `Online payment (Admin Complete)${cash > 0 ? '' : extraNote}`
            }, { transaction: t });
        }
        if (totalReturn > 0) {
            await OrderPayment.create({
                ...paymentBase,
                amount: totalReturn,
                paymentMethod: 'SALES_RETURN',
                notes: `Adjusted ₹${totalReturn.toFixed(2)} from Sales Return (Bill: ₹${billTotal.toFixed(2)})`
            }, { transaction: t });
        }
        if (credit > 0) {
            // Party's total baki after this bill (old due included): the due this delivered bill carries until verified
            await OrderPayment.create({ ...paymentBase, amount: credit, paymentMethod: 'CREDIT', notes: 'Goods given on credit (baki)' }, { transaction: t });

            const newAvailableCredit = Math.max(0, round2(account.maxCredit - credit));
            await PartyBalanceLog.create({
                userId: order.userId,
                orderId: order.id,
                type: 'DUE',
                amount: credit,
                previousBalance: account.availableCredit,
                newBalance: newAvailableCredit,
                note: `Credit (Baki) on Order #${order.orderId || order.id}: ₹${credit.toFixed(2)} (old due ₹${Math.max(0, account.openingBalance).toFixed(2)} incl.). Remaining Available Credit: ₹${newAvailableCredit.toFixed(2)}`,
                createdByName: `Admin Settlement • ${actorName}`
            }, { transaction: t });
        }

        const methodsUsed = [];
        if (cash > 0) methodsUsed.push('CASH');
        if (online > 0) methodsUsed.push('ONLINE');
        if (credit > 0) methodsUsed.push('CREDIT');
        if (totalReturn > 0) methodsUsed.push('SALES_RETURN');

        // Cash / online clear the old due first; the rest of the credit is this bill's own unpaid part
        const netBill = round2(billTotal - coupon);
        const oldDue = Math.max(0, account.openingBalance);
        const pastDueSettled = round2(Math.min(oldDue, cash + online));
        const billUnpaid = Math.min(netBill, Math.max(0, round2(credit - (oldDue - pastDueSettled))));
        order.couponDiscount = coupon.toFixed(2);
        order.discountType = coupon > 0 ? (order.discountType || 'Coupon Discount') : null;
        order.dueAmount = credit.toFixed(2);
        order.paidAmount = Math.max(0, round2(netBill - billUnpaid)).toFixed(2);
        order.pastDueCollected = pastDueSettled.toFixed(2);
        order.paymentStatus = billUnpaid > 0 ? 'Partial' : 'Paid';
        if (methodsUsed.length > 0) {
            order.paymentMethod = methodsUsed.length === 1 ? methodsUsed[0] : 'SPLIT';
        }
        order.orderStatus = 'Payment Collect';
        order.deliveredAt = order.deliveredAt || now;
        if (note) {
            order.notes = order.notes ? `${order.notes}\n${note}` : note;
        }
        await order.save({ transaction: t });

        // Rider (if one was assigned) no longer has this delivery pending
        await OrderAssignment.update(
            { status: 'Completed' },
            { where: { orderId: order.id, status: ['Pending', 'Assigned'] }, transaction: t }
        );

        await t.commit();

        if (order.userId) {
            try {
                await syncPartyLedger(order.userId, { forceRebuild: true });
                await syncPartyDeliveryNotice(order.userId);
            } catch (syncErr) {
                logger.warn(`[Admin Complete Settle Ledger Sync Error]: ${syncErr.message}`);
            }
        }

        await sendDeliveredNotification(order.id);

        try {
            const deliveredOrder = await Order.findByPk(order.id, {
                include: [
                    { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'city', 'routeCategoryId'] },
                    { model: OrderAssignment, as: 'assignment', include: [{ model: DeliveryBoy, as: 'deliveryBoy' }] }
                ]
            });
            if (deliveredOrder) {
                broadcastOrderStatusChanged({
                    order: deliveredOrder,
                    oldStatus: 'Shipping',
                    newStatus: 'Payment Collect',
                    routeCategoryId: deliveredOrder.routeCategoryId || deliveredOrder.user?.routeCategoryId,
                    godownId: deliveredOrder.godownId,
                    deliveryBoyId: deliveredOrder.assignment?.deliveryBoyId || null
                });
            }
            if (user) {
                const freshUser = await User.findByPk(user.id);
                if (freshUser) broadcastUserUpdated(freshUser);
            }
        } catch (sErr) {
            logger.error(`[Socket Broadcast Error in adminCompleteOrderSettlementService]: ${sErr.message}`);
        }

        return {
            success: true,
            order: {
                id: order.id,
                orderId: order.orderId,
                orderStatus: order.orderStatus,
                openingBalance: account.openingBalance,
                billTotal,
                coupon,
                salesReturn: totalReturn,
                cash,
                online,
                credit,
                extraJama: extraAmount
            }
        };
    } catch (error) {
        if (t && !t.finished) await t.rollback();
        throw error;
    }
};

export default {
    getAdminCompleteSettleInfoService,
    adminCompleteOrderSettlementService
};
