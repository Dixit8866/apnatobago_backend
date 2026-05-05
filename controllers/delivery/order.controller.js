import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, Volume, OrderPayment } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

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
        if (status) {
            whereClause.status = status;
        }

        const orderIncludeWhere = {};
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
                        { model: User, as: 'user', attributes: ['fullname', 'number', 'city', 'postcode'] },
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
            ],
            limit,
            offset,
            order: [['position', 'ASC'], ['assignedAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
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
                        { model: User, as: 'user', attributes: ['fullname', 'number', 'city', 'postcode'] },
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
                    orderStatus: { [Op.ne]: 'Cancelled' },
                    orderId: { [Op.ne]: assignment.order.orderId } // Exclude current order
                },
                attributes: ['id', 'orderId', 'totalAmount', 'dueAmount', 'paymentStatus'],
                order: [['createdAt', 'DESC']]
            });

            totalPastDueAmount = pastDueOrders.reduce((sum, order) => sum + parseFloat(order.dueAmount), 0);
        }

        const data = assignment.toJSON();
        data.pastDueOrders = pastDueOrders;
        data.totalPastDueAmount = totalPastDueAmount.toFixed(2);
        data.currentOrderAmount = parseFloat(assignment.order.totalAmount).toFixed(2);
        data.grandTotalAmount = (parseFloat(totalPastDueAmount) + parseFloat(assignment.order.totalAmount)).toFixed(2);

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
        logger.info(`[Update Assignment Status]: Assignment ${assignmentId}, New Status: ${status}, Boy: ${deliveryBoyId}`);

        const assignment = await OrderAssignment.findOne({
            where: { id: assignmentId, deliveryBoyId }
        });

        if (!assignment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found or not assigned to you.");
        }

        const validStatuses = ['Pending', 'Assigned', 'Cancelled', 'Completed'];
        if (status && !validStatuses.includes(status)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid status.");
        }

        await assignment.update({ status, notes: notes || assignment.notes });

        // Optionally update the main Order status if needed
        // if (status === 'Completed') {
        //     await Order.update({ orderStatus: 'Delivered' }, { where: { id: assignment.orderId } });
        // }

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
        let user;
        if (creditAmount > 0) {
            if (!userId) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Cannot use credit: User not associated with this order.");
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
        }

        // Fetch all past due orders for this user
        let pastDueOrders = [];
        if (userId) {
            pastDueOrders = await Order.findAll({
                where: {
                    userId,
                    dueAmount: { [Op.gt]: 0 },
                    orderStatus: { [Op.ne]: 'Cancelled' },
                    id: { [Op.ne]: assignment.orderId } // Exclude current order as we'll add it manually
                },
                order: [['createdAt', 'ASC']], // Oldest first
                transaction: t
            });
        }

        // Prioritize current order first, then past dues
        const ordersToSettle = [];
        if (parseFloat(assignment.order.dueAmount) > 0) {
            ordersToSettle.push(assignment.order);
        }
        ordersToSettle.push(...pastDueOrders);

        let remainingCash = parseFloat(cashAmount) || 0;
        let remainingOnline = parseFloat(onlineAmount) || 0;
        let remainingCredit = parseFloat(creditAmount) || 0;

        for (const order of ordersToSettle) {
            let due = parseFloat(order.dueAmount);
            if (due <= 0) continue;

            let orderNotes = [];
            let paymentMethodsUsed = [];
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
            }

            // Try Credit
            if (remainingCredit > 0 && due > 0) {
                const deduction = Math.min(remainingCredit, due);
                remainingCredit -= deduction;
                due -= deduction;
                order.paidAmount = parseFloat(order.paidAmount) + deduction;
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
                
                // Deduct from User's creditline
                if (user) {
                    user.creditline = parseFloat(user.creditline) - deduction;
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

        // Ensure current order status is updated to Delivered
        await Order.update(
            { orderStatus: 'Delivered' }, 
            { where: { id: assignment.orderId }, transaction: t }
        );

        await assignment.update({ 
            status: 'Completed', 
            notes: notes || assignment.notes 
        }, { transaction: t });

        await t.commit();
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
