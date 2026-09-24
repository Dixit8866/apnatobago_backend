import { Op } from 'sequelize';
import { Order, OrderPayment, User, SalesReturn, OrderAssignment, PartyBalanceLog } from '../models/index.js';
import logger from '../logger/apiLogger.js';

/**
 * ==============================================================================
 * CENTRALIZED FINANCIAL & ORDER SETTLEMENT SERVICE (Single Source of Truth)
 * ==============================================================================
 * This service unifies all order financial calculations, payment settlements,
 * past-due adjustments, and response formatting across Admin, Delivery, and Godown.
 */

/**
 * Calculate accurate order financials based on total amount, coupon discount,
 * delivery charge, and attached payments.
 *
 * @param {Object} order - Sequelize Order instance or plain object
 * @param {Array} [payments] - Optional array of OrderPayment records
 * @returns {Object} { totalAmount, couponDiscount, deliveryCharge, netPayable, payableAmount, paidAmount, dueAmount, paymentStatus, nonCreditPaid, creditAmount }
 */
export const calculateOrderFinancials = (order, payments = null) => {
    if (!order) {
        return {
            totalAmount: 0,
            couponDiscount: 0,
            deliveryCharge: 0,
            netPayable: 0,
            payableAmount: '0.00',
            paidAmount: '0.00',
            dueAmount: '0.00',
            creditAmount: '0.00',
            paymentStatus: 'Pending',
            nonCreditPaid: 0,
        };
    }

    const totalAmt = parseFloat(order.totalAmount || 0);
    const couponDisc = parseFloat(order.couponDiscount || 0);
    const deliveryCharge = parseFloat(order.deliveryCharge || order.shippingCharge || 0);
    const netPayable = Math.max(0, totalAmt - couponDisc + deliveryCharge);

    // Resolve payment records (from parameter, dataValues, or object property)
    const paymentList = payments || order.payments || order.dataValues?.payments || [];
    
    let creditPaymentSum = 0;
    let nonCreditPaid = 0;
    let cashSum = 0;
    let onlineSum = 0;
    let returnSum = 0;

    if (Array.isArray(paymentList) && paymentList.length > 0) {
        paymentList.forEach(p => {
            const m = String(p.paymentMethod || p.method || '').toUpperCase();
            const amt = parseFloat(p.amount || 0);
            if (m === 'CREDIT') {
                creditPaymentSum += amt;
            } else {
                nonCreditPaid += amt;
                if (m === 'CASH') cashSum += amt;
                else if (m === 'ONLINE') onlineSum += amt;
                else if (m === 'SALES_RETURN') returnSum += amt;
            }
        });
    } else {
        nonCreditPaid = parseFloat(order.paidAmount || 0);
    }

    // Determine due amount:
    // 1. If non-credit paid >= net bill (within 1 cent rounding), due is 0
    let dueAmt = 0;
    let paidAmt = Math.min(netPayable, nonCreditPaid);

    if (nonCreditPaid >= netPayable - 0.01) {
        dueAmt = 0;
        paidAmt = netPayable;
    } else if (creditPaymentSum > 0) {
        dueAmt = creditPaymentSum;
    } else if (order.dueAmount !== undefined && order.dueAmount !== null && order.dueAmount !== '') {
        const rawDue = parseFloat(order.dueAmount);
        if (!isNaN(rawDue) && rawDue >= 0) {
            dueAmt = rawDue;
        } else {
            dueAmt = Math.max(0, netPayable - nonCreditPaid);
        }
    } else {
        dueAmt = Math.max(0, netPayable - nonCreditPaid);
    }

    // Determine payment status
    let paymentStatus = 'Pending';
    const isExplicitlyPaid = String(order.paymentStatus || '').toLowerCase() === 'paid';
    if (isExplicitlyPaid || dueAmt <= 0.01) {
        paymentStatus = 'Paid';
        dueAmt = 0;
    } else if (paidAmt > 0) {
        paymentStatus = 'Partial';
    }

    return {
        totalAmount: totalAmt,
        couponDiscount: couponDisc,
        deliveryCharge,
        netPayable,
        payableAmount: netPayable.toFixed(2),
        paidAmount: paidAmt.toFixed(2),
        dueAmount: dueAmt.toFixed(2),
        creditAmount: dueAmt.toFixed(2),
        paymentStatus,
        nonCreditPaid,
        cashSum,
        onlineSum,
        returnSum
    };
};

/**
 * Synchronize and persist order financials in DB atomically.
 *
 * @param {string} orderId - UUID or human-readable orderId
 * @param {Object} [transaction] - Sequelize transaction
 * @returns {Promise<Order>} Updated order instance
 */
export const syncOrderFinancials = async (orderId, transaction = null) => {
    try {
        const order = await Order.findByPk(orderId, {
            include: [{ model: OrderPayment, as: 'payments' }],
            transaction
        });

        if (!order) return null;

        const financials = calculateOrderFinancials(order, order.payments);
        
        await order.update({
            dueAmount: financials.dueAmount,
            paidAmount: financials.paidAmount,
            paymentStatus: financials.paymentStatus,
            couponDiscount: financials.couponDiscount.toFixed(2),
        }, { transaction });

        return order;
    } catch (error) {
        logger.error(`[syncOrderFinancials Error]: ${error.message}`);
        throw error;
    }
};

/**
 * Synchronize delivery notice for a specific party/user.
 * Checks active (non-cancelled, non-delivered) orders. If no active order
 * has a valid delivery notice, clears User.deliveryNotice.
 *
 * @param {string} userId - User ID
 * @param {Object} [transaction] - Sequelize transaction
 * @returns {Promise<string|null>} Active notice or null
 */
export const syncPartyDeliveryNotice = async (userId, transaction = null) => {
    if (!userId) return null;
    try {
        // Find any active order that has a delivery notice
        const activeOrderWithNotice = await Order.findOne({
            where: {
                userId,
                orderStatus: { [Op.notIn]: ['Delivered', 'Cancelled', 'Admin Cancel', 'Auto Cancelled', 'Rejected'] },
                [Op.or]: [
                    { deliveryNotice: { [Op.ne]: null } },
                    { notes: { [Op.ne]: null } }
                ]
            },
            attributes: ['id', 'orderId', 'deliveryNotice', 'notes', 'orderStatus'],
            order: [['createdAt', 'DESC']],
            transaction
        });

        let validNotice = null;
        if (activeOrderWithNotice) {
            const raw = activeOrderWithNotice.deliveryNotice || activeOrderWithNotice.notes;
            const clean = String(raw || '')
                .replace(/^\[Delivery Note\]:\s*/i, '')
                .replace(/\[\d{1,2}\/\d{1,2}\/\d{4}[^\]]*\]\s*Adjustments:[^\n]*/gi, '')
                .trim();
            if (clean && !clean.includes('Adjustments:') && !clean.includes('Settled via Direct Bank Transfer')) {
                validNotice = clean;
            }
        }

        // Update User.deliveryNotice with valid notice or null
        await User.update(
            { deliveryNotice: validNotice || null },
            { where: { id: userId }, transaction }
        );

        return validNotice || null;
    } catch (error) {
        logger.error(`[syncPartyDeliveryNotice Error for userId ${userId}]: ${error.message}`);
        return null;
    }
};

/**
 * Centrally clear delivery notice for an order, assignment, and party.
 *
 * @param {Object} params - { orderId, userId, transaction }
 */
export const clearOrderDeliveryNotice = async ({ orderId, userId, transaction = null }) => {
    try {
        let targetUserId = userId;

        if (orderId) {
            const ord = await Order.findByPk(orderId, { transaction });
            if (ord) {
                if (ord.userId) targetUserId = ord.userId;
                await Order.update({ deliveryNotice: null, notes: null }, { where: { id: ord.id }, transaction });
                if (OrderAssignment) {
                    await OrderAssignment.update({ notes: null }, { where: { orderId: ord.id }, transaction });
                }
            }
        }

        if (targetUserId) {
            await User.update({ deliveryNotice: null }, { where: { id: targetUserId }, transaction });
            await syncPartyDeliveryNotice(targetUserId, transaction);
        }

        return { success: true };
    } catch (error) {
        logger.error(`[clearOrderDeliveryNotice Error]: ${error.message}`);
        throw error;
    }
};

/**
 * Standardize order serialization for all API responses without stripping relations.
 * Ensures 100% backward compatibility for Admin and Delivery Boy Mobile App.
 *
 * @param {Object} order - Sequelize Order instance or plain object
 * @returns {Object} Clean serializable order object
 */
export const adjustOrderResponse = (order) => {
    if (!order) return order;

    // Convert Sequelize instance to plain object safely
    const rowData = order.toJSON ? order.toJSON() : { ...order };

    // Preserve items, payments, and returns if attached via setDataValue
    if (order.dataValues) {
        if (order.dataValues.payments && (!rowData.payments || rowData.payments.length === 0)) {
            rowData.payments = order.dataValues.payments;
        }
        if (order.dataValues.items && (!rowData.items || rowData.items.length === 0)) {
            rowData.items = order.dataValues.items;
        }
        if (order.dataValues.returns && (!rowData.returns || rowData.returns.length === 0)) {
            rowData.returns = order.dataValues.returns;
        }
    }

    const financials = calculateOrderFinancials(rowData, rowData.payments);

    // Set standard response properties (preserving existing response contract)
    rowData.payableAmount = financials.payableAmount;
    rowData.dueAmount = financials.dueAmount;
    rowData.creditAmount = financials.creditAmount;
    rowData.paidAmount = financials.paidAmount;
    rowData.paymentStatus = financials.paymentStatus;
    rowData.couponDiscount = financials.couponDiscount.toFixed(2);
    rowData.couponPoints = Number(rowData.couponPoints || 0);
    rowData.discountType = (rowData.couponPoints > 0 || financials.couponDiscount > 0) 
        ? (rowData.discountType || 'Coupon Discount') 
        : null;

    return rowData;
};

export default {
    calculateOrderFinancials,
    syncOrderFinancials,
    adjustOrderResponse,
    syncPartyDeliveryNotice,
    clearOrderDeliveryNotice,
};

