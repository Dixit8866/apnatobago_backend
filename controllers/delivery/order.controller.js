import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, Volume, OrderPayment, InventoryStock, SalesReturn, Notification } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { sendToDevice } from '../../services/notification.service.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { getTodayRangeIST } from './dashboard.controller.js';

const sendDeliveredNotification = async (orderId) => {
    try {
        const order = await Order.findByPk(orderId, {
            include: [{ model: User, as: 'user' }]
        });
        if (order && order.user && order.user.fcmtoken) {
            const title = 'Order Delivered!';
            const body = `Hey ${order.user.fullname}, your order #${order.orderId} of ₹${order.totalAmount} has been delivered successfully!`;
            await sendToDevice(order.user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
            await Notification.create({
                title,
                body,
                type: 'ORDER',
                target: String(order.userId),
                status: 'SENT',
                clickAction: String(order.id)
            });
        }
    } catch (pushErr) {
        console.error('[Delivered Push Notification Error]:', pushErr);
        logger.error(`[Delivered Push Notification Error]: ${pushErr.message}`);
    }
};

/**
 * @desc    Get assigned orders for the logged-in delivery boy
 * @route   GET /api/delivery/orders
 * @access  Private (Delivery Boy)
 */
export const getMyAssignedOrders = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        const { status, search } = req.query; // 'Pending', 'Assigned', 'Cancelled', 'Completed'
        logger.info(`[Get My Assigned Orders]: Fetching orders for delivery boy ${deliveryBoyId}, status: ${status || 'Any'}`);

        const whereClause = { deliveryBoyId };
        const orderIncludeWhere = {};

        if (status) {
            if (status === 'Cancelled') {
                const { todayStart, todayEnd } = getTodayRangeIST();
                whereClause[Op.and] = [
                    {
                        [Op.or]: [
                            { status: 'Cancelled' },
                            { '$order.orderStatus$': 'Cancelled' }
                        ]
                    },
                    {
                        [Op.or]: [
                            { updatedAt: { [Op.between]: [todayStart, todayEnd] } },
                            { '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] } }
                        ]
                    }
                ];
            } else if (status === 'Completed') {
                const { todayStart, todayEnd } = getTodayRangeIST();
                whereClause.status = 'Completed';
                whereClause.updatedAt = { [Op.between]: [todayStart, todayEnd] };
            } else if (status === 'Assigned' || status === 'Pending') {
                whereClause.status = status;
                orderIncludeWhere.orderStatus = { [Op.ne]: 'Cancelled' };
            } else {
                whereClause.status = status;
            }
        } else {
            const { todayStart, todayEnd } = getTodayRangeIST();
            whereClause[Op.or] = [
                {
                    status: { [Op.in]: ['Pending', 'Assigned'] }
                },
                {
                    status: 'Completed',
                    updatedAt: { [Op.between]: [todayStart, todayEnd] }
                },
                {
                    [Op.and]: [
                        {
                            [Op.or]: [
                                { status: 'Cancelled' },
                                { '$order.orderStatus$': 'Cancelled' }
                            ]
                        },
                        {
                            [Op.or]: [
                                { updatedAt: { [Op.between]: [todayStart, todayEnd] } },
                                { '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] } }
                            ]
                        }
                    ]
                }
            ];
        }

        if (search) {
            orderIncludeWhere.orderId = { [Op.iLike]: `%${search}%` };
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await OrderAssignment.findAndCountAll({
            where: whereClause,
            attributes: { exclude: ['orderId'] },
            include: [
                {
                    model: Order,
                    as: 'order',
                    where: Object.keys(orderIncludeWhere).length > 0 ? orderIncludeWhere : null,
                    include: [
                        { model: User, as: 'user', attributes: ['fullname', 'number', 'city', 'postcode', 'latitude', 'longitude'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['position', 'ASC'], ['assignedAt', 'ASC']],
            subQuery: false
        });

        // Lazy load items for the assigned orders
        if (result.rows.length > 0) {
            const orderIds = result.rows.map(item => item.order?.id).filter(Boolean);

            if (orderIds.length > 0) {
                const items = await OrderItem.findAll({
                    where: { orderId: orderIds },
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        { 
                            model: ProductVariant, 
                            as: 'variant',
                            include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }]
                        }
                    ]
                });

                // Group items by orderId
                const itemsMap = {};
                items.forEach(item => {
                    if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
                    itemsMap[item.orderId].push(item);
                });

                // Attach items to the order models
                result.rows.forEach(item => {
                    if (item.order) {
                        item.order.setDataValue('items', itemsMap[item.order.id] || []);
                    }
                });
            }
        }

        const responseData = formatPaginatedResponse(result, page, limit);

        if (responseData.orders) {
            responseData.orders = responseData.orders.map(item => {
                const data = item.toJSON ? item.toJSON() : item;
                if (data.order && data.order.orderStatus === 'Cancelled') {
                    data.status = 'Cancelled';
                }
                return data;
            });
        }

        logger.info(`[Get My Assigned Orders]: Found ${result.count} orders for delivery boy ${deliveryBoyId}`);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assigned orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get My Assigned Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get order details for delivery boy
 * @route   GET /api/delivery/orders/:assignmentId
 * @access  Private (Delivery Boy)
 */
export const getAssignmentDetails = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const deliveryBoyId = req.user.id;
        logger.info(`[Get Assignment Details]: Fetching assignment ${assignmentId} for delivery boy ${deliveryBoyId}`);

        const assignment = await OrderAssignment.findOne({
            where: { id: assignmentId, deliveryBoyId },
            attributes: { exclude: ['orderId'] },
            include: [
                {
                    model: Order,
                    as: 'order',
                    include: [
                        { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'latitude', 'longitude'] },
                        { model: OrderPayment, as: 'payments' },
                        { 
                            model: OrderItem, 
                            as: 'items',
                            include: [
                                { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                                { 
                                    model: ProductVariant, 
                                    as: 'variant',
                                    include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }]
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!assignment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        // Fetch past due payments for this user
        const userId = assignment.order?.userId;
        let pastDueOrders = [];
        let totalPastDueAmount = 0;

        if (userId) {
            pastDueOrders = await Order.findAll({
                where: {
                    userId,
                    dueAmount: { [Op.gt]: 0 },
                    orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                    orderId: { [Op.ne]: assignment.order.orderId } // Exclude current order
                },
                attributes: ['id', 'orderId', 'totalAmount', 'dueAmount', 'paymentStatus'],
                order: [['createdAt', 'DESC']]
            });

            totalPastDueAmount = pastDueOrders.reduce((sum, order) => sum + parseFloat(order.dueAmount), 0);
        }

        const data = assignment.toJSON();
        
        // Dynamically adjust CREDIT payments based on real (CASH/ONLINE) repayments
        if (data.order && data.order.payments) {
            const payments = data.order.payments || [];
            const totalCredit = payments.filter(p => p.paymentMethod === 'CREDIT').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
            const totalReal = payments.filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
            const orderTotal = parseFloat(data.order.totalAmount || 0);

            const nonCreditPortion = Math.max(0, orderTotal - totalCredit);
            const realPaidToCredit = Math.max(0, totalReal - nonCreditPortion);
            const outstandingCredit = Math.max(0, totalCredit - realPaidToCredit);

            let remainingCreditToDistribute = outstandingCredit;
            for (const payment of payments) {
                if (payment.paymentMethod === 'CREDIT') {
                    const currentAmount = parseFloat(payment.amount || 0);
                    const allowedAmount = Math.min(currentAmount, remainingCreditToDistribute);
                    payment.amount = allowedAmount.toFixed(2);
                    remainingCreditToDistribute -= allowedAmount;
                }
            }
            data.order.payments = payments;
        }

        data.pastDueOrders = pastDueOrders;
        data.totalPastDueAmount = totalPastDueAmount.toFixed(2);
        data.currentOrderAmount = parseFloat(assignment.order.dueAmount).toFixed(2);
        data.grandTotalAmount = (parseFloat(totalPastDueAmount) + parseFloat(assignment.order.dueAmount)).toFixed(2);

        // Force the mobile app to display the remaining due amount instead of the full bill amount
        if (data.order) {
            data.order.totalAmount = parseFloat(assignment.order.dueAmount).toFixed(2);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", data);
    } catch (error) {
        logger.error(`[Get Assignment Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update assignment status by delivery boy
 * @route   PUT /api/delivery/orders/:assignmentId/status
 * @access  Private (Delivery Boy)
 */
export const updateMyAssignmentStatus = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { status, notes } = req.body;
        const deliveryBoyId = req.user.id;
        logger.info(`[Update Assignment Status]: Param ${assignmentId}, New Status: ${status}, Boy: ${deliveryBoyId}`);

        const validStatuses = ['Pending', 'Assigned', 'Cancelled', 'Completed'];
        if (status && !validStatuses.includes(status)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid status.");
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assignmentId);
        const whereConditions = [
            { id: assignmentId }
        ];
        if (isUuid) {
            whereConditions.push({ orderId: assignmentId });
        }

        const assignment = await OrderAssignment.findOne({
            where: {
                deliveryBoyId,
                [Op.or]: whereConditions
            }
        });

        if (!assignment) {
            // Fallback: Check if an Order exists with id = assignmentId
            let order = null;
            if (isUuid) {
                order = await Order.findByPk(assignmentId, { include: [{ model: OrderItem, as: 'items' }] });
            } else {
                order = await Order.findOne({ where: { orderId: assignmentId }, include: [{ model: OrderItem, as: 'items' }] });
            }

            if (!order) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment or Order not found.");
            }

            if (status === 'Cancelled') {
                const prevStatus = order.orderStatus;

                order.orderStatus = 'Delivery Boy Cancel';
                order.dueAmount = 0;
                order.notes = order.notes ? `${order.notes}\n[Delivery Boy Cancelled]: ${notes || 'Refused'}` : `[Delivery Boy Cancelled]: ${notes || 'Refused'}`;
                await order.save();

                if (prevStatus === 'Shipping') {
                    // Create SalesReturn entries (Pending) instead of restoring stock immediately
                    const deliveryBoyId = req.user.id;
                    let totalReturnAmount = 0;
                    for (const item of order.items || []) {
                        const returnQty = Number(item.quantity);
                        const returnAmount = Number(item.price) * returnQty;
                        await SalesReturn.create({
                            orderId: order.id,
                            userId: order.userId,
                            deliveryBoyId,
                            productId: item.productId,
                            variantId: item.variantId,
                            volumeId: item.volumeId || null,
                            quantity: returnQty,
                            price: item.price,
                            returnAmount,
                            reason: 'Cancelled after shipping (Delivery Boy)',
                            status: 'Pending'
                        });
                        totalReturnAmount += returnAmount;
                        await OrderItem.destroy({ where: { id: item.id } });
                    }
                    // Recalculate order totals
                    const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                    let newSubtotal = 0;
                    for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                    order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                    order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                    await order.save();
                } else {
                    // Restore stock for all items (existing behaviour)
                    if (order.items && order.items.length > 0) {
                        for (const item of order.items) {
                            const variant = await ProductVariant.findByPk(item.variantId);
                            const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                            const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                            const baseUnitsToRestore = item.sellUnit === 'Inner' 
                                ? Number(item.quantity) 
                                : Number(item.quantity) * sellingVolume * bUPP;

                            logger.info(`[Delivery Cancel Restore (no-assignment)]: productId=${item.productId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

                            const stock = await InventoryStock.findOne({
                                where: { productId: item.productId },
                                order: [['createdAt', 'DESC']]
                            });
                            if (stock) {
                                await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore });
                            }
                        }
                    }
                }

                const OrderAssignment = order.sequelize.models.OrderAssignment;
                if (OrderAssignment) {
                    await OrderAssignment.update(
                        { status: 'Cancelled', notes: notes || 'Cancelled by Delivery Boy' },
                        { where: { orderId: order.id } }
                    );
                }
            } else if (status === 'Completed') {
                order.orderStatus = 'Delivered';
                await order.save();
                await sendDeliveredNotification(order.id);
            }
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Order status updated successfully.", { order });
        }

        await assignment.update({ status, notes: notes || assignment.notes });

        if (status === 'Cancelled') {
            const order = await Order.findByPk(assignment.orderId, {
                include: [{ model: OrderItem, as: 'items' }]
            });
            if (order) {
                const prevStatus = order.orderStatus;

                order.orderStatus = 'Delivery Boy Cancel';
                order.dueAmount = 0;
                order.notes = order.notes ? `${order.notes}\n[Delivery Boy Cancelled]: ${notes || 'Refused'}` : `[Delivery Boy Cancelled]: ${notes || 'Refused'}`;
                await order.save();

                if (prevStatus === 'Shipping') {
                    // Create SalesReturn entries (Pending)
                    const deliveryBoyId = req.user.id;
                    let totalReturnAmount = 0;
                    for (const item of order.items || []) {
                        const returnQty = Number(item.quantity);
                        const returnAmount = Number(item.price) * returnQty;
                        await SalesReturn.create({
                            orderId: order.id,
                            userId: order.userId,
                            deliveryBoyId,
                            productId: item.productId,
                            variantId: item.variantId,
                            volumeId: item.volumeId || null,
                            quantity: returnQty,
                            price: item.price,
                            returnAmount,
                            reason: 'Cancelled after shipping (Delivery Boy)',
                            status: 'Pending'
                        });
                        totalReturnAmount += returnAmount;
                        await OrderItem.destroy({ where: { id: item.id } });
                    }
                    const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                    let newSubtotal = 0;
                    for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                    order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                    order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                    await order.save();
                } else {
                    // Restore stock for all items (existing behaviour)
                    if (order.items && order.items.length > 0) {
                        for (const item of order.items) {
                            const variant = await ProductVariant.findByPk(item.variantId);
                            const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                            const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                            const baseUnitsToRestore = item.sellUnit === 'Inner' 
                                ? Number(item.quantity) 
                                : Number(item.quantity) * sellingVolume * bUPP;

                            logger.info(`[Delivery Cancel Restore (assignment)]: productId=${item.productId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

                            const stock = await InventoryStock.findOne({
                                where: { productId: item.productId },
                                order: [['createdAt', 'DESC']]
                            });
                            if (stock) {
                                await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore });
                            }
                        }
                    }
                }
            }
        } else if (status === 'Completed') {
            await Order.update({ orderStatus: 'Delivered' }, { where: { id: assignment.orderId } });
            await sendDeliveredNotification(assignment.orderId);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assignment status updated successfully.", assignment);
    } catch (error) {
        logger.error(`[Update Assignment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk update assignment positions or single item shifting
 * @route   PUT /api/delivery/orders/reorder
 * @access  Private (Delivery Boy)
 */
export const reorderAssignments = async (req, res) => {
    const transaction = await OrderAssignment.sequelize.transaction();
    try {
        const { id, fromIndex, toIndex } = req.body;
        const deliveryBoyId = req.user.id;
        logger.info(`[Reorder Assignments]: Boy: ${deliveryBoyId}, ID: ${id}, from ${fromIndex} to ${toIndex}`);

        if (id === undefined || fromIndex === undefined || toIndex === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "id, fromIndex, and toIndex are required.");
        }

        if (fromIndex === toIndex) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "No changes needed.");
        }

        if (toIndex < fromIndex) {
            // Moving UP: Shift items in between DOWN
            await OrderAssignment.increment('position', {
                by: 1,
                where: {
                    deliveryBoyId,
                    position: { [Op.gte]: toIndex, [Op.lt]: fromIndex }
                },
                transaction
            });
        } else {
            // Moving DOWN: Shift items in between UP
            await OrderAssignment.increment('position', {
                by: -1,
                where: {
                    deliveryBoyId,
                    position: { [Op.gt]: fromIndex, [Op.lte]: toIndex }
                },
                transaction
            });
        }

        // Update the target item's position
        await OrderAssignment.update(
            { position: toIndex },
            { where: { id, deliveryBoyId }, transaction }
        );

        await transaction.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order reordered and shifted successfully.");
    } catch (error) {
        if (transaction) await transaction.rollback();
        logger.error(`[Reorder Assignments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Complete an order and settle multiple payments (current + past dues)
 * @route   PUT /api/delivery/orders/:assignmentId/complete-settle
 * @access  Private (Delivery Boy)
 */
export const completeOrderAndSettlePayment = async (req, res) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const { assignmentId } = req.params;
        const { 
            cashAmount = 0, 
            onlineAmount = 0, 
            creditAmount = 0, 
            onlineTransactionId, 
            notes 
        } = req.body;
        const deliveryBoyId = req.user.id;

        const assignment = await OrderAssignment.findOne({
            where: { id: assignmentId, deliveryBoyId },
            include: [{ model: Order, as: 'order' }],
            transaction: t
        });

        if (!assignment) {
            logger.warn(`[Complete Order Settle]: Assignment ${assignmentId} not found for delivery boy ${deliveryBoyId}`);
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        logger.info(`[Complete Order Settle]: Starting settlement for assignment ${assignmentId}, delivery boy ${deliveryBoyId}`);

        const userId = assignment.order.userId;

        // Verify user credit if creditAmount is used
        let user = null;
        if (userId) {
            user = await User.findByPk(userId, { transaction: t });
        }

        if (creditAmount > 0) {
            if (!user) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Cannot use credit: User not associated with this order.");
            }
            if (parseFloat(user.creditline) < parseFloat(creditAmount)) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Insufficient credit. Available: ${user.creditline}, Attempted: ${creditAmount}`);
            }
        }

        // Fetch all past due orders for this user
        let pastDueOrders = [];
        if (userId) {
            pastDueOrders = await Order.findAll({
                where: {
                    userId,
                    dueAmount: { [Op.gt]: 0 },
                    orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                    id: { [Op.ne]: assignment.orderId } // Exclude current order as we'll add it manually
                },
                order: [['createdAt', 'ASC']], // Oldest first
                transaction: t
            });
        }

        // ─── PRIORITIZE PAST DUE ORDERS ──────────────────────────────────────────────
        // We now put past due orders and the current order in the settlement queue,
        // and explicitly sort them chronologically (oldest first, down to milliseconds)
        // so that payments are always applied to older bills before newer ones.
        const ordersToSettle = [];
        ordersToSettle.push(...pastDueOrders);
        if (parseFloat(assignment.order.dueAmount) > 0) {
            ordersToSettle.push(assignment.order);
        }

        ordersToSettle.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        // ─────────────────────────────────────────────────────────────────────────────

        let remainingCash = parseFloat(cashAmount) || 0;
        let remainingOnline = parseFloat(onlineAmount) || 0;
        let remainingCredit = parseFloat(creditAmount) || 0;

        // ─── FIX: PREVENT DOUBLE COUNTING OF ONLINE PAYMENTS ────────────────────────
        let onlineAppliedToCurrent = false;
        if (remainingOnline > 0 && onlineTransactionId && assignment.order.razorpayPaymentId === onlineTransactionId) {
            logger.info(`[Complete Order Settle]: Online payment ${onlineTransactionId} already reflected. Checking for existing payment entry...`);
            
            // Check if the payment entry was already recorded by verifyRazorpayPayment
            const existingPayment = await OrderPayment.findOne({
                where: {
                    transactionId: onlineTransactionId,
                    paymentMethod: 'ONLINE'
                },
                transaction: t
            });

            if (!existingPayment) {
                logger.info(`[Complete Order Settle]: Recording missing payment entry for online txn ${onlineTransactionId}`);
                await OrderPayment.create({
                    orderId: assignment.order.id,
                    deliveryBoyId,
                    amount: remainingOnline,
                    paymentMethod: 'ONLINE',
                    transactionId: onlineTransactionId,
                    notes: 'Recorded during delivery settlement (already verified)'
                }, { transaction: t });

                // Restore user's credit from this online payment only if we recorded it now
                await restoreUserCreditFromPayment(assignment.order.id, remainingOnline, user, t);
            } else {
                logger.info(`[Complete Order Settle]: Payment entry for online txn ${onlineTransactionId} already exists. Skipping duplicate creation and credit restoration.`);
            }

            // Mark that online was applied so we can include it in paymentMethodsUsed later
            onlineAppliedToCurrent = true;
            // Reset to 0 so the loop below doesn't subtract it again from the dueAmount
            remainingOnline = 0;
        }
        // ─────────────────────────────────────────────────────────────────────────────

        for (const order of ordersToSettle) {
            let due = parseFloat(order.dueAmount);
            if (due <= 0) continue;

            let orderNotes = [];
            let paymentMethodsUsed = [];
            
            // If this is the current order and online was already applied, include it in methods and notes
            if (order.id === assignment.orderId && onlineAppliedToCurrent) {
                paymentMethodsUsed.push('ONLINE');
                orderNotes.push(`Paid ${onlineAmount} via Online (Already Verified)`);
            }
            
            let rzpId = order.razorpayPaymentId;

            // Try Cash
            if (remainingCash > 0 && due > 0) {
                const deduction = Math.min(remainingCash, due);
                remainingCash -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                orderNotes.push(`Paid ${deduction} via Cash`);
                paymentMethodsUsed.push('CASH');
                
                logger.info(`[Complete Order Settle]: Creating CASH payment for order ${order.id}, amount ${deduction}, delivery boy ${deliveryBoyId}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CASH',
                    notes: 'Auto-adjusted during delivery settlement'
                }, { transaction: t });

                // Restore user's credit from this cash payment
                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            // Try Online
            if (remainingOnline > 0 && due > 0) {
                const deduction = Math.min(remainingOnline, due);
                remainingOnline -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                if (onlineTransactionId) {
                    rzpId = onlineTransactionId;
                    orderNotes.push(`Paid ${deduction} via Online (Txn: ${onlineTransactionId})`);
                } else {
                    orderNotes.push(`Paid ${deduction} via Online`);
                }
                paymentMethodsUsed.push('ONLINE');
                
                logger.info(`[Complete Order Settle]: Creating ONLINE payment for order ${order.id}, amount ${deduction}, delivery boy ${deliveryBoyId}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'ONLINE',
                    transactionId: onlineTransactionId,
                    notes: 'Auto-adjusted during delivery settlement'
                }, { transaction: t });

                // Restore user's credit from this online payment
                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            // Try Credit (ONLY for the current order of this assignment!)
            if (remainingCredit > 0 && due > 0 && order.id === assignment.order.id) {
                const deduction = Math.min(remainingCredit, due);
                remainingCredit -= deduction;
                // Note: Credit payment represents giving goods on credit (baki), 
                // so the order's dueAmount remains unchanged for the credit portion 
                // and is still considered a pending due.
                orderNotes.push(`Paid ${deduction} via Credit`);
                paymentMethodsUsed.push('CREDIT');
                
                logger.info(`[Complete Order Settle]: Creating CREDIT payment for order ${order.id}, amount ${deduction}, delivery boy ${deliveryBoyId}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CREDIT',
                    notes: 'Auto-adjusted via User Credit'
                }, { transaction: t });
                
                // Deduct from User's creditline and block their credit
                if (user) {
                    user.creditline = parseFloat(user.creditline) - deduction;
                    user.blockcredit = true;
                }
            }

            // Update order record
            order.dueAmount = due;
            
            let newPaymentStatus = 'Pending';
            if (due <= 1e-7) {
                newPaymentStatus = 'Paid';
            }
            order.paymentStatus = newPaymentStatus;

            // Combine methods if multiple, else keep primary
            let finalMethod = order.paymentMethod;
            if (paymentMethodsUsed.length === 1) {
                finalMethod = paymentMethodsUsed[0];
            } else if (paymentMethodsUsed.length > 1) {
                finalMethod = 'SPLIT';
            }

            let newNotes = order.notes ? order.notes + '\n' : '';
            if (orderNotes.length > 0) {
                newNotes += `[${new Date().toLocaleString()}] Adjustments: ${orderNotes.join(', ')}`;
            } else {
                newNotes = order.notes;
            }

            await order.update({
                paidAmount: order.paidAmount,
                dueAmount: order.dueAmount,
                paymentStatus: order.paymentStatus,
                razorpayPaymentId: rzpId,
                paymentMethod: finalMethod,
                notes: newNotes
            }, { transaction: t });
        }

        if (user) {
            await user.save({ transaction: t });
        }

        // Ensure current order status is updated to Payment Collect so it lands in the Payment Collect tab
        await Order.update(
            { orderStatus: 'Payment Collect' }, 
            { where: { id: assignment.orderId }, transaction: t }
        );

        await assignment.update({ 
            status: 'Completed', 
            notes: notes || assignment.notes 
        }, { transaction: t });

        await t.commit();

        // Trigger Delivered Push Notification
        await sendDeliveredNotification(assignment.orderId);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order delivered and payments auto-adjusted successfully.");
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Complete Order Settle Error]: ${error.message}`);
        
        // Return debug info in the error response for troubleshooting
        return res.status(500).json({
            success: false,
            message: error.message,
            debug: {
                deliveryBoyId: req.user?.id,
                userObject: req.user ? { id: req.user.id, name: req.user.fullname || req.user.name } : null,
                assignmentId: req.params.assignmentId
            }
        });
    }
};

/**
 * @desc    Get user credit details (creditline and blockcredit)
 * @route   GET /api/delivery/orders/user-credit/:userId
 * @access  Private (Delivery Boy)
 */
export const getUserCreditDetails = async (req, res) => {
    try {
        const { userId } = req.params;
        logger.info(`[Get User Credit]: Fetching credit info for user ${userId}`);

        const user = await User.findByPk(userId, {
            attributes: ['id', 'creditline', 'blockcredit']
        });

        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "User credit details fetched.", {
            id: user.id,
            creditline: parseFloat(user.creditline || 0),
            blockcredit: user.blockcredit || false
        });
    } catch (error) {
        logger.error(`[Get User Credit Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Settle a single or multiple specific orders by Order ID or UUID
 * @route   PUT /api/delivery/orders/settle-single
 * @access  Private (Delivery Boy)
 */
export const settleSingleOrderPayment = async (req, res) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const { 
            orderId, 
            cashAmount = 0, 
            onlineAmount = 0, 
            creditAmount = 0, 
            onlineTransactionId, 
            notes 
        } = req.body;
        const deliveryBoyId = req.user.id;

        if (!orderId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "orderId is required.");
        }

        logger.info(`[Settle Single Order]: Settle request for order(s) ${JSON.stringify(orderId)}, delivery boy ${deliveryBoyId}`);

        // Normalize orderId to array
        let orderIds = [];
        if (Array.isArray(orderId)) {
            orderIds = orderId;
        } else if (typeof orderId === 'string') {
            orderIds = orderId.split(',').map(id => id.trim()).filter(Boolean);
        }

        // Separate UUIDs and non-UUIDs to avoid Postgres casting errors
        const uuidIds = orderIds.filter(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
        const nonUuidIds = orderIds.filter(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));

        const orConditions = [];
        if (uuidIds.length > 0) {
            orConditions.push({ id: uuidIds });
        }
        if (nonUuidIds.length > 0) {
            orConditions.push({ orderId: nonUuidIds });
        }

        if (orConditions.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No valid order ID provided.");
        }

        // Find all specified orders
        const orders = await Order.findAll({
            where: {
                [Op.or]: orConditions
            },
            transaction: t
        });

        if (orders.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `No orders found with ID(s) ${JSON.stringify(orderId)}`);
        }

        // Sort orders by oldest first for chronological auto-adjustment
        orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const userId = orders[0].userId;
        let user = null;
        if (parseFloat(creditAmount) > 0) {
            if (!userId) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Cannot use credit: User not associated with these orders.");
            }
            user = await User.findByPk(userId, { transaction: t });
            if (!user) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
            }
            if (parseFloat(user.creditline) < parseFloat(creditAmount)) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Insufficient credit. Available: ${user.creditline}, Attempted: ${creditAmount}`);
            }
        } else if (userId) {
            user = await User.findByPk(userId, { transaction: t });
        }

        let remainingCash = parseFloat(cashAmount) || 0;
        let remainingOnline = parseFloat(onlineAmount) || 0;
        let remainingCredit = parseFloat(creditAmount) || 0;

        for (const order of orders) {
            let due = parseFloat(order.dueAmount);
            if (due <= 0) continue;

            let orderNotes = [];
            let paymentMethodsUsed = [];

            // Try Cash
            if (remainingCash > 0 && due > 0) {
                const deduction = Math.min(remainingCash, due);
                remainingCash -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                orderNotes.push(`Paid ${deduction} via Cash`);
                paymentMethodsUsed.push('CASH');

                logger.info(`[Settle Single]: Creating CASH payment for order ${order.id}, amount ${deduction}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CASH',
                    notes: 'Settle Single Payment (Cash)'
                }, { transaction: t });

                // Restore user's credit from this cash payment
                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            // Try Online
            if (remainingOnline > 0 && due > 0) {
                const deduction = Math.min(remainingOnline, due);
                remainingOnline -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
                const txnIdStr = onlineTransactionId ? ` (Txn: ${onlineTransactionId})` : '';
                orderNotes.push(`Paid ${deduction} via Online${txnIdStr}`);
                paymentMethodsUsed.push('ONLINE');

                logger.info(`[Settle Single]: Creating ONLINE payment for order ${order.id}, amount ${deduction}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'ONLINE',
                    transactionId: onlineTransactionId,
                    notes: 'Settle Single Payment (Online)'
                }, { transaction: t });

                // Restore user's credit from this online payment
                await restoreUserCreditFromPayment(order.id, deduction, user, t);
            }

            // Try Credit
            if (remainingCredit > 0 && due > 0) {
                const deduction = Math.min(remainingCredit, due);
                remainingCredit -= deduction;
                // Note: Credit payment represents giving goods on credit (baki), 
                // so the order's dueAmount remains unchanged for the credit portion 
                // and is still considered a pending due.
                orderNotes.push(`Paid ${deduction} via Credit`);
                paymentMethodsUsed.push('CREDIT');

                logger.info(`[Settle Single]: Creating CREDIT payment for order ${order.id}, amount ${deduction}`);
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'CREDIT',
                    notes: 'Settle Single Payment (Credit)'
                }, { transaction: t });

                // Deduct from User's creditline and block their credit
                if (user) {
                    user.creditline = parseFloat(user.creditline) - deduction;
                    user.blockcredit = true;
                }
            }

            // Update order status/payment
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

            let newNotes = order.notes ? order.notes + '\n' : '';
            if (orderNotes.length > 0) {
                newNotes += `[${new Date().toLocaleString()}] Single Settle Adjustments: ${orderNotes.join(', ')}`;
            } else {
                newNotes = order.notes;
            }

            await order.update({
                paidAmount: order.paidAmount,
                dueAmount: due,
                paymentStatus: newPaymentStatus,
                paymentMethod: finalMethod,
                orderStatus: 'Payment Collect',
                notes: newNotes
            }, { transaction: t });

            // Complete associated assignment if found
            const assignment = await OrderAssignment.findOne({
                where: { orderId: order.id, deliveryBoyId },
                transaction: t
            });
            if (assignment) {
                await assignment.update({
                    status: 'Completed',
                    notes: notes || assignment.notes
                }, { transaction: t });
            }
        }

        if (user) {
            await user.save({ transaction: t });
        }

        await t.commit();

        // Trigger Delivered Push Notification for each settled order
        for (const order of orders) {
            await sendDeliveredNotification(order.id);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders settled successfully.", {
            settledOrders: orders.map(o => ({
                id: o.id,
                orderId: o.orderId,
                paidAmount: o.paidAmount,
                dueAmount: o.dueAmount,
                paymentStatus: o.paymentStatus,
                paymentMethod: o.paymentMethod
            }))
        });
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Settle Single Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * Helper to restore user's creditline when CASH or ONLINE payment is made towards an order that has CREDIT payments.
 */
export const restoreUserCreditFromPayment = async (orderId, paymentAmount, user, transaction) => {
    try {
        if (!user || paymentAmount <= 0) return;

        // 1. Get all CREDIT payments for this order
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
                    // Fully cleared - delete the credit payment record!
                    await creditPayment.destroy({ transaction });
                } else {
                    // Partially cleared - update the credit payment record with the reduced amount!
                    await creditPayment.update({ amount: newAmount }, { transaction });
                }
                remainingRealPayment -= reduction;
                
                // Restore user's creditline by the same reduction amount!
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
