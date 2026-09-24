import { Op } from 'sequelize';
import { 
    OrderAssignment, 
    Order, 
    User, 
    OrderItem, 
    OrderPayment, 
    SalesReturn, 
    PartyBalanceLog, 
    DeliveryBoy 
} from '../../models/index.js';
import logger from '../../logger/apiLogger.js';
import { uploadToS3 } from '../../utils/aws.s3.js';
import { broadcastOrderStatusChanged } from '../socketEvent.service.js';
import { syncPartyDeliveryNotice } from '../financialSettlement.service.js';
import { sendDeliveredNotification } from './deliveryOrder.service.js';

/**
 * ==============================================================================
 * DELIVERY SETTLEMENT SERVICE
 * ==============================================================================
 * Centralizes all payment settlement logic for delivery boys including:
 * - Full & split payment settlements
 * - Sales return adjustments
 * - Customer credit restoration
 * - Advance Jama recording
 * - Bank transfer proof submissions
 */

/**
 * Restore user's creditline when CASH/ONLINE payment is made towards an order with CREDIT payments.
 */
export const restoreUserCreditFromPayment = async (orderId, paymentAmount, user, transaction) => {
    try {
        if (!user || paymentAmount <= 0) return;

        const creditPayments = await OrderPayment.findAll({
            where: { orderId, paymentMethod: 'CREDIT' },
            order: [['createdAt', 'ASC']],
            transaction
        });

        let remainingRealPayment = paymentAmount;

        for (const creditPayment of creditPayments) {
            if (remainingRealPayment <= 0) break;

            const creditAmt = parseFloat(creditPayment.amount || 0);
            const reduction = Math.min(creditAmt, remainingRealPayment);

            if (reduction > 0) {
                const newAmount = creditAmt - reduction;
                if (newAmount <= 1e-4) {
                    await creditPayment.destroy({ transaction });
                } else {
                    await creditPayment.update({ amount: newAmount }, { transaction });
                }
                remainingRealPayment -= reduction;

                user.creditline = parseFloat(user.creditline) + reduction;
                if (parseFloat(user.creditline) > 0) {
                    user.blockcredit = false;
                }
                logger.info(`[Restore Credit]: Cleared ${reduction} of credit payment ${creditPayment.id}. Restored to user creditline.`);
            }
        }
    } catch (error) {
        logger.error(`[Restore Credit Error]: ${error.message}`);
    }
};

/**
 * Complete order and settle multiple payments (current + past dues)
 */
export const completeOrderAndSettlePaymentService = async ({ assignmentId, deliveryBoyId, body, reqUser }) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const {
            cashAmount = 0,
            onlineAmount = 0,
            creditAmount = 0,
            salesReturnAmount = 0,
            returnAmount = 0,
            salesReturnItems,
            returnItems,
            onlineTransactionId,
            notes,
            note,
            deliveryNote,
            totalCouponPoints,
            couponPoints,
            totalCouponPrice,
            couponDiscount,
            couponPrice,
            discountType,
            couponItems
        } = body;

        const customDeliveryNote = String(notes || note || deliveryNote || '').trim();

        const assignment = await OrderAssignment.findOne({
            where: { id: assignmentId, deliveryBoyId },
            include: [{ model: Order, as: 'order' }],
            transaction: t
        });

        if (!assignment) {
            await t.rollback();
            return { notFound: true };
        }

        // 1. Handle product-wise coupon items
        if (Array.isArray(couponItems) && couponItems.length > 0) {
            for (const cItem of couponItems) {
                const itemPts = Number(cItem.couponPoints || cItem.points || 0);
                const itemDisc = parseFloat(cItem.couponPrice || cItem.discount || cItem.price || 0);

                const whereCond = { orderId: assignment.order.id };
                if (cItem.itemId || cItem.id) whereCond.id = cItem.itemId || cItem.id;
                else if (cItem.productId) whereCond.productId = cItem.productId;

                await OrderItem.update({
                    hasCoupon: itemPts > 0 || itemDisc > 0,
                    couponPoints: itemPts,
                    couponPrice: itemDisc
                }, {
                    where: whereCond,
                    transaction: t
                });
            }
        }

        // Calculate actual sum of coupon items
        const allOrderItems = await OrderItem.findAll({
            where: { orderId: assignment.order.id },
            transaction: t
        });

        const totalOrderCouponPts = allOrderItems.reduce((sum, item) => sum + Number(item.couponPoints || 0), 0);
        const totalOrderCouponDisc = allOrderItems.reduce((sum, item) => sum + parseFloat(item.couponPrice || 0), 0);

        const passedDisc = couponDiscount !== undefined ? parseFloat(couponDiscount) : (totalCouponPrice !== undefined ? parseFloat(totalCouponPrice) : (couponPrice !== undefined ? parseFloat(couponPrice) : 0));
        const passedPts = couponPoints !== undefined ? Number(couponPoints) : (totalCouponPoints !== undefined ? Number(totalCouponPoints) : 0);

        const existingCouponPts = Number(assignment.order?.couponPoints || 0);
        const existingCouponDisc = parseFloat(assignment.order?.couponDiscount || 0);

        const finalCouponPts = Math.max(totalOrderCouponPts, existingCouponPts + passedPts);
        const finalCouponDisc = Math.max(totalOrderCouponDisc, existingCouponDisc + passedDisc);

        if (assignment.order) {
            assignment.order.couponPoints = finalCouponPts;
            assignment.order.couponDiscount = finalCouponDisc.toFixed(2);
            assignment.order.discountType = (finalCouponPts > 0 || finalCouponDisc > 0) ? (discountType || 'Coupon Discount') : null;

            const netPayableBill = Math.max(0, parseFloat(assignment.order.totalAmount || 0) - finalCouponDisc);
            const netDueBeforePayment = Math.max(0, netPayableBill - parseFloat(assignment.order.paidAmount || 0));
            assignment.order.dueAmount = netDueBeforePayment.toFixed(2);
            await assignment.order.save({ transaction: t });
        }

        const userId = assignment.order.userId;

        let user = null;
        if (userId) {
            user = await User.findByPk(userId, { transaction: t });
        }

        if (creditAmount > 0) {
            if (!user) {
                await t.rollback();
                return { error: "Cannot use credit: User not associated with this order." };
            }
            if (parseFloat(user.creditline) < parseFloat(creditAmount)) {
                await t.rollback();
                return { error: `Insufficient credit. Available: ${user.creditline}, Attempted: ${creditAmount}` };
            }
        }

        // Fetch past due orders
        let pastDueOrders = [];
        if (userId) {
            pastDueOrders = await Order.findAll({
                where: {
                    userId,
                    dueAmount: { [Op.gt]: 0 },
                    orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                    id: { [Op.ne]: assignment.orderId }
                },
                order: [['createdAt', 'ASC']],
                transaction: t
            });
        }

        const inputCash = parseFloat(cashAmount) || 0;
        const inputOnline = parseFloat(onlineAmount) || 0;
        const inputCredit = parseFloat(creditAmount) || 0;
        let inputReturn = Math.round(parseFloat(salesReturnAmount || returnAmount || 0));

        if (inputReturn === 0 && user) {
            const unadjustedReturns = await SalesReturn.findAll({
                where: {
                    userId: user.id,
                    creditProcessed: false,
                    status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                },
                transaction: t
            });
            inputReturn = Math.round(unadjustedReturns.reduce((sum, r) => sum + parseFloat(r.returnAmount || 0), 0));
        }

        const totalPastDue = pastDueOrders.reduce((sum, o) => sum + parseFloat(o.dueAmount || 0), 0);
        const currentBillTotal = parseFloat(assignment.order.totalAmount || 0);
        const netBill = Math.max(0, currentBillTotal - finalCouponDisc);

        const currentBillCashOnlineNeeded = Math.max(0, netBill - inputReturn - inputCredit);
        const totalCashOnlineCollected = inputCash + inputOnline;
        const pastDueSettled = Math.min(totalPastDue, Math.max(0, totalCashOnlineCollected - currentBillCashOnlineNeeded));

        // Settle past due orders
        let remainingToClearPast = pastDueSettled;
        for (const pOrder of pastDueOrders) {
            if (remainingToClearPast <= 0) break;
            const pDue = parseFloat(pOrder.dueAmount);
            if (pDue <= 0) continue;
            const clearAmt = Math.min(pDue, remainingToClearPast);
            remainingToClearPast -= clearAmt;
            pOrder.dueAmount = Math.max(0, pDue - clearAmt);
            pOrder.paidAmount = parseFloat(pOrder.paidAmount || 0) + clearAmt;
            pOrder.paymentStatus = pOrder.dueAmount <= 1e-7 ? 'Paid' : 'Partial';
            await pOrder.save({ transaction: t });

            await OrderPayment.create({
                orderId: pOrder.id,
                deliveryBoyId,
                amount: clearAmt,
                paymentMethod: 'CASH',
                notes: `Auto-adjusted ₹${clearAmt} past due during delivery of Order #${assignment.order.orderId || assignment.orderId}`
            }, { transaction: t });

            await restoreUserCreditFromPayment(pOrder.id, clearAmt, user, t);
        }

        // Create Sales Return records if provided
        const returnItemsList = salesReturnItems || returnItems;
        if (Array.isArray(returnItemsList) && returnItemsList.length > 0) {
            for (const rItem of returnItemsList) {
                if (rItem.productId && Number(rItem.quantity) > 0) {
                    const rPrice = parseFloat(rItem.price || 0);
                    const rQty = Number(rItem.quantity);
                    const rAmt = parseFloat(rItem.returnAmount || (rPrice * rQty));
                    await SalesReturn.create({
                        orderId: assignment.order.id,
                        userId: assignment.order.userId,
                        deliveryBoyId,
                        productId: rItem.productId,
                        variantId: rItem.variantId || null,
                        volumeId: rItem.volumeId || null,
                        quantity: rQty,
                        price: rPrice,
                        returnAmount: rAmt,
                        reason: rItem.reason || 'Customer Return at Delivery',
                        status: 'Pending',
                        creditProcessed: true
                    }, { transaction: t });
                }
            }
        }

        if (user && inputReturn > 0) {
            await SalesReturn.update(
                { creditProcessed: true },
                {
                    where: {
                        userId: user.id,
                        creditProcessed: false,
                        status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                    },
                    transaction: t
                }
            );
        }

        const cashUsedForPastDue = Math.min(inputCash, pastDueSettled);
        const onlineUsedForPastDue = Math.max(0, pastDueSettled - cashUsedForPastDue);

        const currentOrderCash = Math.max(0, inputCash - cashUsedForPastDue);
        const currentOrderOnline = Math.max(0, inputOnline - onlineUsedForPastDue);

        // Record true payments ON CURRENT ASSIGNMENT ORDER
        if (currentOrderCash > 0) {
            const existingCash = await OrderPayment.findOne({
                where: { orderId: assignment.order.id, paymentMethod: 'CASH' },
                transaction: t
            });
            if (existingCash) {
                await existingCash.update({ amount: currentOrderCash }, { transaction: t });
            } else {
                await OrderPayment.create({
                    orderId: assignment.order.id,
                    deliveryBoyId,
                    amount: currentOrderCash,
                    paymentMethod: 'CASH',
                    notes: 'Cash collected during delivery'
                }, { transaction: t });
            }
        } else {
            await OrderPayment.destroy({
                where: { orderId: assignment.order.id, paymentMethod: 'CASH' },
                transaction: t
            });
        }

        if (currentOrderOnline > 0) {
            const existingOnline = await OrderPayment.findOne({
                where: { orderId: assignment.order.id, paymentMethod: 'ONLINE' },
                transaction: t
            });
            if (existingOnline) {
                await existingOnline.update({ amount: currentOrderOnline, transactionId: onlineTransactionId || existingOnline.transactionId }, { transaction: t });
            } else {
                await OrderPayment.create({
                    orderId: assignment.order.id,
                    deliveryBoyId,
                    amount: currentOrderOnline,
                    paymentMethod: 'ONLINE',
                    transactionId: onlineTransactionId,
                    notes: 'Online payment during delivery'
                }, { transaction: t });
            }
        } else {
            await OrderPayment.destroy({
                where: { orderId: assignment.order.id, paymentMethod: 'ONLINE' },
                transaction: t
            });
        }

        if (inputReturn > 0) {
            const existingReturn = await OrderPayment.findOne({
                where: { orderId: assignment.order.id, paymentMethod: 'SALES_RETURN' },
                transaction: t
            });
            if (existingReturn) {
                await existingReturn.update({ amount: inputReturn }, { transaction: t });
            } else {
                await OrderPayment.create({
                    orderId: assignment.order.id,
                    deliveryBoyId,
                    amount: inputReturn,
                    paymentMethod: 'SALES_RETURN',
                    notes: `Adjusted ₹${inputReturn} from Sales Return (Bill: ₹${assignment.order.totalAmount})`
                }, { transaction: t });
            }
        } else {
            await OrderPayment.destroy({
                where: { orderId: assignment.order.id, paymentMethod: 'SALES_RETURN' },
                transaction: t
            });
        }

        if (inputCredit > 0) {
            const existingCredit = await OrderPayment.findOne({
                where: { orderId: assignment.order.id, paymentMethod: 'CREDIT' },
                transaction: t
            });
            if (existingCredit) {
                await existingCredit.update({ amount: inputCredit }, { transaction: t });
            } else {
                await OrderPayment.create({
                    orderId: assignment.order.id,
                    deliveryBoyId,
                    amount: inputCredit,
                    paymentMethod: 'CREDIT',
                    notes: 'Goods given on credit (baki)'
                }, { transaction: t });
            }

            if (user) {
                user.creditline = Math.max(0, parseFloat(user.creditline || 0) - inputCredit);
                if (user.creditline <= 0) {
                    user.blockcredit = true;
                }
            }
        } else {
            await OrderPayment.destroy({
                where: { orderId: assignment.order.id, paymentMethod: 'CREDIT' },
                transaction: t
            });
        }

        assignment.order.dueAmount = inputCredit.toFixed(2);
        const actualPaidOnThisBill = Math.max(0, netBill - inputCredit);
        assignment.order.paidAmount = actualPaidOnThisBill.toFixed(2);
        assignment.order.pastDueCollected = pastDueSettled.toFixed(2);
        assignment.order.paymentStatus = inputCredit <= 1e-7 ? 'Paid' : 'Partial';

        const paymentMethodsUsed = [];
        if (currentOrderCash > 0) paymentMethodsUsed.push('CASH');
        if (currentOrderOnline > 0) paymentMethodsUsed.push('ONLINE');
        if (inputCredit > 0) paymentMethodsUsed.push('CREDIT');
        if (inputReturn > 0) paymentMethodsUsed.push('SALES_RETURN');

        if (paymentMethodsUsed.length === 1) {
            assignment.order.paymentMethod = paymentMethodsUsed[0];
        } else if (paymentMethodsUsed.length > 1) {
            assignment.order.paymentMethod = 'SPLIT';
        }

        if (customDeliveryNote) {
            assignment.order.notes = customDeliveryNote;
            assignment.order.deliveryNotice = customDeliveryNote;
            await assignment.order.save({ transaction: t });
            if (user) {
                user.deliveryNotice = customDeliveryNote;
                await user.save({ transaction: t });
            }
        }

        let remainingCash = Math.max(0, totalCashOnlineCollected - currentBillCashOnlineNeeded - pastDueSettled);
        let remainingOnline = 0;
        let remainingSalesReturn = Math.max(0, inputReturn - netBill);

        if (user) {
            const excessCashOnline = (remainingCash > 0 ? remainingCash : 0) + (remainingOnline > 0 ? remainingOnline : 0);
            const excessReturn = remainingSalesReturn > 0 ? remainingSalesReturn : 0;
            const excessCollected = excessCashOnline + excessReturn;

            if (excessCollected > 0) {
                const prevCredit = parseFloat(user.creditline || 0);
                user.creditline = prevCredit + excessCollected;
                const newCredit = user.creditline;
                
                const noteParts = [];
                if (excessCashOnline > 0) noteParts.push(`Cash/Online Overpayment: +₹${excessCashOnline.toFixed(2)}`);
                if (excessReturn > 0) noteParts.push(`Excess Sales Return: +₹${excessReturn.toFixed(2)}`);

                await PartyBalanceLog.create({
                    userId: user.id,
                    orderId: assignment.orderId,
                    type: 'JAMA',
                    amount: excessCollected,
                    previousBalance: prevCredit,
                    newBalance: newCredit,
                    note: `Credit Jama on Order #${assignment.order?.orderId || assignment.orderId}: +₹${excessCollected.toFixed(2)} (${noteParts.join(', ')})`,
                    createdByName: 'Delivery Boy Settlement'
                }, { transaction: t });

                if (remainingCash > 0) {
                    const existingCashPay = await OrderPayment.findOne({
                        where: { orderId: assignment.orderId, paymentMethod: 'CASH' },
                        transaction: t
                    });
                    if (existingCashPay) {
                        const newAmt = parseFloat(existingCashPay.amount) + remainingCash;
                        await existingCashPay.update({
                            amount: newAmt,
                            notes: `Cash collected ₹${newAmt.toFixed(2)} (Bill: ₹${assignment.order?.totalAmount || '0'} + Advance Jama: +₹${remainingCash.toFixed(2)})`
                        }, { transaction: t });
                    } else {
                        await OrderPayment.create({
                            orderId: assignment.orderId,
                            deliveryBoyId,
                            amount: remainingCash,
                            paymentMethod: 'CASH',
                            notes: `Advance Jama Credit Cash (+₹${remainingCash.toFixed(2)})`
                        }, { transaction: t });
                    }
                }
            }
            await user.save({ transaction: t });
        }

        await Order.update(
            { orderStatus: 'Payment Collect', deliveredAt: Order.sequelize.literal('COALESCE("deliveredAt", NOW())') },
            { where: { id: assignment.orderId }, transaction: t }
        );

        await assignment.update({
            status: 'Completed',
            notes: customDeliveryNote || assignment.notes
        }, { transaction: t });

        await t.commit();

        await sendDeliveredNotification(assignment.orderId);

        try {
            const deliveredOrder = await Order.findByPk(assignment.orderId, {
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
                    deliveryBoyId
                });
            }
        } catch (sErr) {
            logger.error(`[Socket Broadcast Error in completeOrderAndSettlePaymentService]: ${sErr.message}`);
        }

        return { success: true };
    } catch (error) {
        if (t) await t.rollback();
        throw error;
    }
};

/**
 * Settle single order payment
 */
export const settleSingleOrderPaymentService = async ({ deliveryBoyId, body, reqUser }) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const {
            orderId,
            cashAmount = 0,
            onlineAmount = 0,
            creditAmount = 0,
            salesReturnAmount = 0,
            returnAmount = 0,
            salesReturnItems,
            returnItems,
            onlineTransactionId,
            notes,
            note,
            deliveryNote
        } = body;

        const customDeliveryNote = String(notes || note || deliveryNote || '').trim();

        if (!orderId) {
            await t.rollback();
            return { badRequest: "orderId is required." };
        }

        let orderIds = [];
        if (Array.isArray(orderId)) {
            orderIds = orderId;
        } else if (typeof orderId === 'string') {
            orderIds = orderId.split(',').map(id => id.trim()).filter(Boolean);
        }

        const uuidIds = orderIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
        const nonUuidIds = orderIds.filter(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));

        const orConditions = [];
        if (uuidIds.length > 0) orConditions.push({ id: uuidIds });
        if (nonUuidIds.length > 0) orConditions.push({ orderId: nonUuidIds });

        if (orConditions.length === 0) {
            await t.rollback();
            return { badRequest: "No valid order ID provided." };
        }

        const orders = await Order.findAll({
            where: { [Op.or]: orConditions },
            transaction: t
        });

        if (orders.length === 0) {
            await t.rollback();
            return { notFound: `No orders found with ID(s) ${JSON.stringify(orderId)}` };
        }

        orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const userId = orders[0].userId;
        let user = null;
        if (parseFloat(creditAmount) > 0) {
            if (!userId) {
                await t.rollback();
                return { badRequest: "Cannot use credit: User not associated with these orders." };
            }
            user = await User.findByPk(userId, { transaction: t });
            if (!user) {
                await t.rollback();
                return { notFound: "User not found." };
            }
            if (parseFloat(user.creditline) < parseFloat(creditAmount)) {
                await t.rollback();
                return { badRequest: `Insufficient credit. Available: ${user.creditline}, Attempted: ${creditAmount}` };
            }
        } else if (userId) {
            user = await User.findByPk(userId, { transaction: t });
        }

        let remainingCash = parseFloat(cashAmount) || 0;
        let remainingOnline = parseFloat(onlineAmount) || 0;
        let remainingCredit = parseFloat(creditAmount) || 0;
        let remainingSalesReturn = Math.round(parseFloat(salesReturnAmount || returnAmount || 0));

        if (remainingSalesReturn === 0 && user) {
            const unadjustedReturns = await SalesReturn.findAll({
                where: {
                    userId: user.id,
                    creditProcessed: false,
                    status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                },
                transaction: t
            });
            remainingSalesReturn = Math.round(unadjustedReturns.reduce((sum, r) => sum + parseFloat(r.returnAmount || 0), 0));
        }

        for (const order of orders) {
            let due = parseFloat(order.dueAmount);
            if (due <= 0) continue;

            let orderNotes = [];
            let paymentMethodsUsed = [];

            if (remainingSalesReturn > 0 && due > 0) {
                const returnDeduction = Math.min(remainingSalesReturn, due);
                remainingSalesReturn -= returnDeduction;
                due -= returnDeduction;
                order.paidAmount = parseFloat(order.paidAmount) + returnDeduction;
                orderNotes.push(`Paid ₹${returnDeduction.toFixed(2)} via Sales Return`);
                paymentMethodsUsed.push('SALES_RETURN');

                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: returnDeduction,
                    paymentMethod: 'SALES_RETURN',
                    notes: `Adjusted ₹${returnDeduction.toFixed(2)} from Sales Return (Bill: ₹${order.totalAmount})`
                }, { transaction: t });

                if (user) {
                    await SalesReturn.update(
                        { creditProcessed: true },
                        {
                            where: {
                                userId: user.id,
                                creditProcessed: false,
                                status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                            },
                            transaction: t
                        }
                    );
                }

                const returnItemsList = salesReturnItems || returnItems;
                if (Array.isArray(returnItemsList) && returnItemsList.length > 0) {
                    for (const rItem of returnItemsList) {
                        if (rItem.productId && Number(rItem.quantity) > 0) {
                            const rPrice = parseFloat(rItem.price || 0);
                            const rQty = Number(rItem.quantity);
                            const rAmt = parseFloat(rItem.returnAmount || (rPrice * rQty));
                            await SalesReturn.create({
                                orderId: order.id,
                                userId: order.userId,
                                deliveryBoyId,
                                productId: rItem.productId,
                                variantId: rItem.variantId || null,
                                volumeId: rItem.volumeId || null,
                                quantity: rQty,
                                price: rPrice,
                                returnAmount: rAmt,
                                reason: rItem.reason || 'Customer Return at Delivery',
                                status: 'Pending',
                                creditProcessed: true
                            }, { transaction: t });
                        }
                    }
                }
            }

            if (remainingCash > 0 && due > 0) {
                const deduction = Math.min(remainingCash, due);
                remainingCash -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                orderNotes.push(`Paid ${deduction} via Cash`);
                paymentMethodsUsed.push('CASH');

                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CASH',
                    notes: 'Settle Single Payment (Cash)'
                }, { transaction: t });

                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            if (remainingOnline > 0 && due > 0) {
                const deduction = Math.min(remainingOnline, due);
                remainingOnline -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                const txnIdStr = onlineTransactionId ? ` (Txn: ${onlineTransactionId})` : '';
                orderNotes.push(`Paid ${deduction} via Online${txnIdStr}`);
                paymentMethodsUsed.push('ONLINE');

                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'ONLINE',
                    transactionId: onlineTransactionId,
                    notes: 'Settle Single Payment (Online)'
                }, { transaction: t });

                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            if (remainingCredit > 0 && due > 0) {
                const deduction = Math.min(remainingCredit, due);
                remainingCredit -= deduction;
                orderNotes.push(`Paid ${deduction} via Credit (Baki)`);
                paymentMethodsUsed.push('CREDIT');

                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CREDIT',
                    notes: 'Settle Single Payment (Credit - Baki)'
                }, { transaction: t });

                if (user) {
                    user.creditline = Math.max(0, parseFloat(user.creditline || 0) - deduction);
                    if (user.creditline <= 0) {
                        user.blockcredit = true;
                    }
                }
            }

            let newPaymentStatus = 'Pending';
            if (due <= 1e-7) {
                newPaymentStatus = 'Paid';
            } else if (parseFloat(order.paidAmount) > 0) {
                newPaymentStatus = 'Partial';
            }

            let finalMethod = order.paymentMethod;
            if (paymentMethodsUsed.length === 1) {
                finalMethod = paymentMethodsUsed[0];
            } else if (paymentMethodsUsed.length > 1) {
                finalMethod = 'SPLIT';
            }

            await order.update({
                paidAmount: order.paidAmount,
                dueAmount: due,
                paymentStatus: newPaymentStatus,
                paymentMethod: finalMethod,
                orderStatus: 'Payment Collect',
                notes: customDeliveryNote || order.notes,
                deliveryNotice: customDeliveryNote || order.deliveryNotice
            }, { transaction: t });

            if (customDeliveryNote && order.userId) {
                await User.update({ deliveryNotice: customDeliveryNote }, { where: { id: order.userId }, transaction: t });
            }

            const assignment = await OrderAssignment.findOne({
                where: { orderId: order.id, deliveryBoyId },
                transaction: t
            });
            if (assignment) {
                await assignment.update({
                    status: 'Completed',
                    notes: customDeliveryNote || assignment.notes
                }, { transaction: t });
            }
        }

        if (user) {
            await user.save({ transaction: t });
        }

        await t.commit();

        for (const order of orders) {
            await sendDeliveredNotification(order.id);
        }

        return {
            settledOrders: orders.map(o => ({
                id: o.id,
                orderId: o.orderId,
                paidAmount: o.paidAmount,
                dueAmount: o.dueAmount,
                paymentStatus: o.paymentStatus,
                paymentMethod: o.paymentMethod
            }))
        };
    } catch (error) {
        if (t) await t.rollback();
        throw error;
    }
};

/**
 * Submit delivery boy bank payment proof
 */
export const submitDeliveryBankPaymentService = async ({ orderIdOrUuid, deliveryBoyId, body, files, file }) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const { bankSettingId, screenshot, transactionId, amount, notes, note, deliveryNote } = body;
        const customDeliveryNote = String(notes || note || deliveryNote || '').trim();

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdOrUuid);
        const orderWhere = isUUID ? { id: orderIdOrUuid } : { orderId: orderIdOrUuid };

        const order = await Order.findOne({ where: orderWhere, transaction: t });

        if (!order) {
            await t.rollback();
            return { notFound: true };
        }

        if (!bankSettingId) {
            await t.rollback();
            return { badRequest: "Bank account selection is required." };
        }

        let finalScreenshot = screenshot || null;
        const uploadedFile = files?.image?.[0] || files?.screenshot?.[0] || file;
        if (uploadedFile) {
            const uploadResult = await uploadToS3(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
            if (uploadResult.success) {
                finalScreenshot = uploadResult.url;
            } else {
                await t.rollback();
                return { uploadError: "Failed to upload payment screenshot to S3." };
            }
        }

        const paymentAmount = amount ? parseFloat(amount) : parseFloat(order.totalAmount);
        
        const payment = await OrderPayment.create({
            orderId: order.id,
            deliveryBoyId,
            amount: paymentAmount,
            paymentMethod: 'ONLINE',
            onlineType: 'Bank Account',
            bankSettingId,
            screenshot: finalScreenshot || null,
            transactionId: transactionId || null,
            isSubmitted: false,
            notes: 'Submitted via Delivery Boy App'
        }, { transaction: t });

        const assignment = await OrderAssignment.findOne({
            where: {
                orderId: order.id,
                deliveryBoyId,
                status: { [Op.in]: ['Pending', 'Assigned'] }
            },
            transaction: t
        });

        if (assignment) {
            await assignment.update({
                status: 'Completed',
                notes: customDeliveryNote || 'Settled via Direct Bank Transfer in Delivery Boy App'
            }, { transaction: t });
        }

        await order.update({
            orderStatus: 'Payment Verify',
            deliveredAt: order.deliveredAt || new Date(),
            notes: customDeliveryNote || order.notes,
            deliveryNotice: customDeliveryNote || order.deliveryNotice
        }, { transaction: t });

        if (customDeliveryNote && order.userId) {
            await User.update({ deliveryNotice: customDeliveryNote }, { where: { id: order.userId }, transaction: t });
        }

        await t.commit();

        await sendDeliveredNotification(order.id);

        return { payment };
    } catch (error) {
        if (t) await t.rollback();
        throw error;
    }
};

export default {
    completeOrderAndSettlePaymentService,
    settleSingleOrderPaymentService,
    submitDeliveryBankPaymentService,
    restoreUserCreditFromPayment
};
