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
    if ((isExplicitlyPaid && creditPaymentSum <= 0.01 && nonCreditPaid >= netPayable - 0.01) || dueAmt <= 0.01) {
        paymentStatus = 'Paid';
        dueAmt = 0;
    } else if (paidAmt > 0 || dueAmt > 0) {
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
export const isSystemOrAuditNotice = (raw) => {
    if (!raw || typeof raw !== 'string') return true;
    const s = raw.trim();
    if (!s) return true;
    if (s.startsWith('[') && s.endsWith(']')) return true;
    if (
        s.includes('Due Cleared') || 
        s.includes('Due adjusted') || 
        s.includes('Adjustments:') || 
        s.includes('Settled via') || 
        s.includes('Single Settle') || 
        s.includes('Verified & Settled') || 
        s.includes('Advance Jama') ||
        s.includes('Admin')
    ) {
        return true;
    }
    return false;
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
        // Find any active order that has an explicit manual delivery notice
        const activeOrderWithNotice = await Order.findOne({
            where: {
                userId,
                orderStatus: { [Op.notIn]: ['Delivered', 'Cancelled', 'Admin Cancel', 'Auto Cancelled', 'Rejected'] },
                deliveryNotice: { [Op.ne]: null }
            },
            attributes: ['id', 'orderId', 'deliveryNotice', 'orderStatus'],
            order: [['createdAt', 'DESC']],
            transaction
        });

        let validNotice = null;
        if (activeOrderWithNotice && activeOrderWithNotice.deliveryNotice) {
            const raw = activeOrderWithNotice.deliveryNotice;
            if (!isSystemOrAuditNotice(raw)) {
                validNotice = String(raw).replace(/^\[Delivery Note\]:\s*/i, '').trim();
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
        let customerPhone = null;

        if (orderId) {
            const ord = await Order.findByPk(orderId, {
                include: [{ model: User, as: 'user', attributes: ['id', 'number'] }],
                transaction
            });
            if (ord) {
                if (ord.userId) targetUserId = ord.userId;
                customerPhone = ord.user?.number || ord.customerNumber || null;
                
                // Clear on this specific order
                await Order.update({ deliveryNotice: null }, { where: { id: ord.id }, transaction });
                if (OrderAssignment) {
                    await OrderAssignment.update({ notes: null }, { where: { orderId: ord.id }, transaction });
                }
            }
        }

        if (targetUserId) {
            const u = await User.findByPk(targetUserId, { transaction });
            if (u && u.number) customerPhone = u.number;

            // Clear on all orders belonging to this user
            await Order.update({ deliveryNotice: null }, { where: { userId: targetUserId }, transaction });
            await User.update({ deliveryNotice: null }, { where: { id: targetUserId }, transaction });
        }

        if (customerPhone && String(customerPhone).replace(/\D/g, '').length >= 7) {
            const cleanPhone = String(customerPhone).replace(/\D/g, '').slice(-10);
            await User.update(
                { deliveryNotice: null }, 
                { where: { number: { [Op.like]: `%${cleanPhone}%` } }, transaction }
            );
            await Order.update(
                { deliveryNotice: null }, 
                { where: { customerNumber: { [Op.like]: `%${cleanPhone}%` } }, transaction }
            );
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

/**
 * ==============================================================================
 * CENTRALIZED CUSTOMER CREDIT & DUE FINANCIAL SERVICE (Single Source of Truth)
 * ==============================================================================
 * Unifies Customer Credit Limit, Used Due, Past Due, and Available Credit calculations
 * across Admin Panel, Delivery App, and Order Settlements.
 *
 * @param {Object} params
 * @param {string} [params.userId] - User ID UUID
 * @param {string} [params.userPhone] - Customer phone number for matching
 * @param {string} [params.excludeOrderId] - Current order ID being processed (excluded from past due)
 * @param {Object} [params.user] - Optional pre-fetched User instance or object
 * @param {Object} [params.transaction] - Optional Sequelize transaction
 * @returns {Promise<Object>}
 */
export const getCustomerCreditFinancials = async ({
    userId = null,
    userPhone = null,
    excludeOrderId = null,
    user = null,
    transaction = null
} = {}) => {
    try {
        let customerUser = user;
        if (!customerUser && userId) {
            customerUser = await User.findByPk(userId, {
                attributes: ['id', 'fullname', 'number', 'creditline', 'advanceJama', 'balanceType', 'blockcredit'],
                transaction
            });
        }

        const cleanPhone = (userPhone || customerUser?.number)
            ? String(userPhone || customerUser?.number).replace(/\D/g, '').slice(-10)
            : '';

        if (!customerUser && cleanPhone && cleanPhone.length >= 7) {
            customerUser = await User.findOne({
                where: { number: { [Op.like]: `%${cleanPhone}` } },
                attributes: ['id', 'fullname', 'number', 'creditline', 'advanceJama', 'balanceType', 'blockcredit'],
                transaction
            });
        }

        const effectiveUserId = customerUser?.id || userId;
        const baseCreditLimit = parseFloat(customerUser?.creditline || 0);
        const userAdvanceJama = parseFloat(customerUser?.advanceJama || 0);

        // Build where conditions to locate orders
        const matchConditions = [];
        if (effectiveUserId) {
            matchConditions.push({ userId: effectiveUserId });
        }
        if (cleanPhone && cleanPhone.length >= 7) {
            matchConditions.push({ customerNumber: { [Op.like]: `%${cleanPhone}` } });
        }

        let totalUnpaidDue = 0;
        const pastDueOrders = [];

        if (matchConditions.length > 0) {
            const orderWhere = {
                [Op.or]: matchConditions,
                orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel', 'Auto Cancelled', 'Rejected'] }
            };

            if (excludeOrderId) {
                orderWhere.id = { [Op.ne]: excludeOrderId };
            }

            const candidateOrders = await Order.findAll({
                where: orderWhere,
                include: [
                    {
                        model: OrderPayment,
                        as: 'payments',
                        required: false,
                        attributes: ['id', 'amount', 'paymentMethod', 'notes', 'createdAt']
                    }
                ],
                attributes: ['id', 'orderId', 'userId', 'customerNumber', 'totalAmount', 'couponDiscount', 'paidAmount', 'dueAmount', 'paymentStatus', 'orderStatus', 'createdAt'],
                order: [['createdAt', 'DESC']],
                transaction
            });

            candidateOrders.forEach(ord => {
                // Determine if this order constitutes an unpaid due / used credit:
                // An order counts as past due ONLY if:
                // 1) It has been delivered/settled (Delivered, Payment Collect, Payment Verify, Completed)
                // OR
                // 2) It has an explicit CREDIT payment record
                // OR
                // 3) dueAmount > 0 and paidAmount > 0 (partial settlement happened)
                const isDeliveredOrSettled = ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'].includes(ord.orderStatus);
                const payments = ord.payments || [];
                const hasCreditPayment = payments.some(p => String(p.paymentMethod || '').toUpperCase() === 'CREDIT' && parseFloat(p.amount || 0) > 0);
                const hasPartialSettlement = parseFloat(ord.paidAmount || 0) > 0 && parseFloat(ord.dueAmount || 0) > 0;

                // If the order is un-delivered (Pending, Packaging, Packed, Assigned) and has no credit payment,
                // it is an in-transit order, NOT past used credit!
                if (!isDeliveredOrSettled && !hasCreditPayment && !hasPartialSettlement) {
                    return;
                }

                const fin = calculateOrderFinancials(ord, payments);
                const due = fin.paymentStatus !== 'Paid' ? parseFloat(fin.dueAmount) : 0;

                if (due > 0.01) {
                    totalUnpaidDue += due;
                    pastDueOrders.push({
                        id: ord.id,
                        orderId: ord.orderId,
                        totalAmount: fin.totalAmount,
                        couponDiscount: fin.couponDiscount,
                        paidAmount: parseFloat(fin.paidAmount),
                        dueAmount: parseFloat(due.toFixed(2)),
                        paymentStatus: fin.paymentStatus,
                        orderStatus: ord.orderStatus,
                        createdAt: ord.createdAt
                    });
                }
            });
        }

        const roundedUsedDue = parseFloat(totalUnpaidDue.toFixed(2));
        // Include advanceJama (excess overpayment by customer) in availableCredit
        // e.g. baseCreditLimit=5000, advanceJama=10 → availableCredit=5010
        const availableCredit = Math.max(0, parseFloat((baseCreditLimit + userAdvanceJama - roundedUsedDue).toFixed(2)));
        const isBlocked = customerUser?.blockcredit ? true : false;

        return {
            userId: effectiveUserId,
            baseCreditLimit,
            usedCredit: roundedUsedDue,
            totalDue: roundedUsedDue,
            totalUnpaidDue: roundedUsedDue,
            availableCredit,
            creditLimit: availableCredit,    // Returns available credit so delivery app and components show available balance!
            creditAmount: availableCredit,   // Returns available credit so delivery app showing Credit Amount shows available balance!
            creditline: availableCredit,     // Available credit
            blockcredit: (isBlocked && availableCredit <= 0),
            pastDueOrders,
            advanceJama: userAdvanceJama
        };
    } catch (error) {
        logger.error(`[getCustomerCreditFinancials Error]: ${error.message}`);
        return {
            userId,
            baseCreditLimit: 0,
            usedCredit: 0,
            totalDue: 0,
            totalUnpaidDue: 0,
            availableCredit: 0,
            creditLimit: 0,
            creditAmount: 0,
            creditline: 0,
            blockcredit: false,
            pastDueOrders: [],
            advanceJama: 0
        };
    }
};

export default {
    calculateOrderFinancials,
    syncOrderFinancials,
    adjustOrderResponse,
    syncPartyDeliveryNotice,
    clearOrderDeliveryNotice,
    getCustomerCreditFinancials,
};

