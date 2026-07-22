import { Op } from 'sequelize';
import { Order, OrderItem, OrderPayment, User, Product, ProductVariant, Godown, RouteCategory, BusinessProfile, OrderAssignment, DeliveryBoy, AppSettings, Notification } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import sequelize from '../../config/db.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { sendToDevice } from '../../services/notification.service.js';

/**
 * @desc    Get orders for this godown
 * @route   GET /api/godown-panel/sales
 * @access  Private (GodownStaff)
 */
export const getGodownOrders = async (req, res, next) => {
    try {
        const staff = req.user;
        const {
            page = 1,
            limit = 20,
            search = '',
            status = '',
            type = 'active',
            paymentStatus = '',
            routeCategoryId = '',
            deliveryTiming = '',
            deliveryBoyId = '',
            startDate = '',
            endDate = '',
            dateType = 'createdAt',
            godownId: filterGodownId
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const activeStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping'];
        const historyStatuses = ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
        const pendingDueStatuses = ['Delivered', 'Payment Collect', 'Payment Verify'];

        // Godown restriction
        const godownFilter = { godownId: staff.godownId };

        let orderStatusFilter = {};
        if (status === 'Pending Due Order') {
            // Special tab: show all delivered/collect/verify with unpaid payment
            orderStatusFilter = { orderStatus: { [Op.in]: pendingDueStatuses } };
        } else if (status) {
            orderStatusFilter = { orderStatus: status };
        } else if (type === 'history') {
            orderStatusFilter = { orderStatus: { [Op.in]: historyStatuses } };
        } else {
            orderStatusFilter = { orderStatus: { [Op.in]: activeStatuses } };
        }

        // Payment status filter (for Pending Due Order)
        const paymentStatusFilter = (status === 'Pending Due Order' || paymentStatus)
            ? { paymentStatus: paymentStatus || { [Op.ne]: 'Paid' } }
            : {};

        const searchFilter = search ? {
            [Op.or]: [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerNumber: { [Op.iLike]: `%${search}%` } },
            ]
        } : {};

        // Delivery timing filter (8-13 = morning, 14-20 = afternoon)
        const timingFilter = deliveryTiming ? (() => {
            const [startH, endH] = deliveryTiming.split('-').map(Number);
            const now = new Date();
            const start = new Date(now); start.setHours(startH, 0, 0, 0);
            const end = new Date(now); end.setHours(endH, 0, 0, 0);
            return { createdAt: { [Op.between]: [start, end] } };
        })() : {};

        // Route category filter (Order has routeCategoryId directly)
        const routeFilter = routeCategoryId ? { routeCategoryId } : {};

        // Date range filter (Order Date or Delivery Date)
        let dateFilter = {};
        if (startDate || endDate) {
            const dateField = dateType === 'deliveredAt' ? 'deliveredAt' : 'createdAt';
            dateFilter[dateField] = {};
            if (startDate) dateFilter[dateField][Op.gte] = new Date(startDate + 'T00:00:00.000Z');
            if (endDate)   dateFilter[dateField][Op.lte] = new Date(endDate   + 'T23:59:59.999Z');
        }

        const where = {
            ...godownFilter,
            ...orderStatusFilter,
            ...paymentStatusFilter,
            ...searchFilter,
            ...timingFilter,
            ...routeFilter,
            ...dateFilter,
        };

        const { count, rows } = await Order.findAndCountAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city'],
                    required: false,
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['shopName', 'shopAddress', 'postcode'],
                            required: false,
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'mainCategoryId'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'volumeId'] },
                    ],
                    required: false,
                },
                {
                    model: OrderPayment,
                    as: 'payments',
                    required: false,
                },
                {
                    model: Godown,
                    as: 'godown',
                    attributes: ['id', 'name'],
                    required: false,
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    required: false,
                    include: [
                        {
                            model: DeliveryBoy,
                            as: 'deliveryBoy',
                            attributes: ['id', 'name', 'phone']
                        }
                    ]
                },
            ],
            limit: parseInt(limit),
            offset,
            order: [['createdAt', 'DESC']],
        });

        // Build status counts for tabs
        const countQuery = {
            ...godownFilter,
        };

        const statusCountRows = await Order.findAll({
            where: countQuery,
            attributes: ['orderStatus', [Order.sequelize.fn('COUNT', Order.sequelize.col('id')), 'count']],
            group: ['orderStatus'],
            raw: true,
        });

        const statusCounts = {};
        statusCountRows.forEach(r => {
            statusCounts[r.orderStatus] = parseInt(r.count);
        });

        // Pending Due Order count (delivered/collect/verify + unpaid)
        const pendingDueCount = await Order.count({
            where: {
                ...godownFilter,
                orderStatus: { [Op.in]: pendingDueStatuses },
                paymentStatus: { [Op.ne]: 'Paid' },
            }
        });
        statusCounts['Pending Due Order'] = pendingDueCount;

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Orders fetched successfully', {
            data: rows,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalRecords: count,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update order status by godown staff
 * @route   PATCH /api/godown-panel/sales/:id/status
 * @access  Private (GodownStaff)
 */
export const updateGodownOrderStatus = async (req, res, next) => {
    try {
        const staff = req.user;
        const { id } = req.params;
        const { orderStatus } = req.body;

        const order = await Order.findOne({
            where: {
                id,
                godownId: staff.godownId,
            }
        });

        if (!order) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Order not found or not in your godown');

        const allowedTransitions = {
            Pending: ['Packaging', 'Cancelled'],
            Packaging: ['Packed', 'Cancelled'],
            Packed: ['Shipping', 'Cancelled'],
            Shipping: ['Delivered'],
        };

        const allowed = allowedTransitions[order.orderStatus] || [];
        if (!allowed.includes(orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Cannot change status from ${order.orderStatus} to ${orderStatus}`);
        }

        const now = new Date();
        const updates = { orderStatus };
        if (orderStatus === 'Packaging') updates.packagingAt = now;
        if (orderStatus === 'Packed') updates.packedAt = now;
        if (orderStatus === 'Shipping') updates.shippingAt = now;
        if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) updates.deliveredAt = order.deliveredAt || now;

        await order.update(updates);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Order status updated', order);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Bulk update order status by godown staff
 * @route   PUT /api/godown-panel/sales/bulk-status
 * @access  Private (GodownStaff)
 */
export const bulkUpdateGodownOrderStatus = async (req, res, next) => {
    try {
        const staff = req.user;
        const isSuperAdmin = staff.role === 'superadmin';
        const { orderIds, orderStatus } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled'];
        if (!validStatuses.includes(orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
        }

        const targetStatus = orderStatus === 'Cancelled' ? 'Admin Cancel' : orderStatus;
        const updateFields = { orderStatus: targetStatus };
        const now = new Date();

        if (orderStatus === 'Cancelled') {
            updateFields.dueAmount = 0;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Pending') {
            updateFields.packagingAt = null;
            updateFields.packedAt = null;
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Packaging') {
            updateFields.packagingAt = now;
            updateFields.packedAt = null;
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Packed') {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = now;
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Shipping') {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = Order.sequelize.literal('COALESCE("packedAt", NOW())');
            updateFields.shippingAt = now;
            updateFields.deliveredAt = null;
        } else if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = Order.sequelize.literal('COALESCE("packedAt", NOW())');
            updateFields.shippingAt = Order.sequelize.literal('COALESCE("shippingAt", NOW())');
            updateFields.deliveredAt = Order.sequelize.literal('COALESCE("deliveredAt", NOW())');
        }

        await Order.update(
            updateFields,
            {
                where: {
                    id: { [Op.in]: orderIds },
                    godownId: staff.godownId
                }
            }
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${orderIds.length} orders status updated successfully.`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Bulk assign delivery boy to orders (and move to Shipping)
 * @route   PUT /api/godown-panel/sales/bulk-assign
 * @access  Private (GodownStaff)
 */
export const bulkAssignGodownOrders = async (req, res, next) => {
    try {
        const staff = req.user;
        const isSuperAdmin = staff.role === 'superadmin';
        const { orderIds, deliveryBoyId } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No orders selected for assignment.");
        }

        const boy = await DeliveryBoy.findByPk(deliveryBoyId);
        if (!boy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Delivery boy not found.");
        }

        // Restrict assigning to orders inside user's godown
        const orders = await Order.findAll({
            where: {
                id: { [Op.in]: orderIds },
                godownId: staff.godownId
            }
        });

        const validOrderIds = orders.map(o => o.id);
        if (validOrderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No valid orders found in your godown to assign.");
        }

        for (const orderId of validOrderIds) {
            const existing = await OrderAssignment.findOne({ where: { orderId } });
            if (existing) {
                await existing.update({ deliveryBoyId, status: 'Assigned', assignedAt: new Date() });
            } else {
                await OrderAssignment.create({ orderId, deliveryBoyId, status: 'Assigned' });
            }
        }

        // Move the orders to Shipping status
        const now = new Date();
        await Order.update(
            {
                orderStatus: 'Shipping',
                packagingAt: Order.sequelize.literal('COALESCE("packagingAt", NOW())'),
                packedAt: Order.sequelize.literal('COALESCE("packedAt", NOW())'),
                shippingAt: now,
                deliveredAt: null
            },
            {
                where: { id: { [Op.in]: validOrderIds } }
            }
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${validOrderIds.length} orders assigned and moved to Shipping successfully.`);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Merge orders of the same customer in the godown
 * @route   POST /api/godown-panel/sales/merge
 * @access  Private (GodownStaff)
 */
export const mergeGodownOrders = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const staff = req.user;
        const { sourceOrderId, sourceOrderIds, targetOrderId, targetStatus } = req.body;

        const resolvedSourceOrderIds = sourceOrderIds || (sourceOrderId ? [sourceOrderId] : []);

        if (resolvedSourceOrderIds.length === 0 || !targetOrderId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Source and Target Order IDs are required.");
        }

        if (resolvedSourceOrderIds.includes(targetOrderId)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Cannot merge an order into itself.");
        }

        // Fetch target order
        const targetOrder = await Order.findOne({
            where: {
                id: targetOrderId,
                godownId: staff.godownId
            },
            include: [{ model: OrderItem, as: 'items' }],
            transaction: t
        });

        if (!targetOrder) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Target order not found or not in your godown.");
        }

        let combinedNotes = [targetOrder.notes];
        let newPaidAmount = Number(targetOrder.paidAmount || 0);

        // Verify status of target is mergeable (Pending, Packaging, Packed)
        const allowedStatuses = ['Pending', 'Packaging', 'Packed'];
        if (!allowedStatuses.includes(targetOrder.orderStatus)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Target order must be in Pending, Packaging, or Packed status.");
        }

        // Loop through each source order and merge it
        for (const sId of resolvedSourceOrderIds) {
            const sourceOrder = await Order.findOne({
                where: {
                    id: sId,
                    godownId: staff.godownId
                },
                include: [{ model: OrderItem, as: 'items' }],
                transaction: t
            });

            if (!sourceOrder) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Source order ${sId} not found or not in your godown.`);
            }

            // Verify they belong to the same customer
            const sameUser = sourceOrder.userId && targetOrder.userId && sourceOrder.userId === targetOrder.userId;
            const sameGuest = !sourceOrder.userId && !targetOrder.userId && 
                              sourceOrder.customerName === targetOrder.customerName && 
                              sourceOrder.customerNumber === targetOrder.customerNumber;

            if (!sameUser && !sameGuest) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Orders must belong to the same customer to be merged.");
            }

            if (!allowedStatuses.includes(sourceOrder.orderStatus)) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Only orders in Pending, Packaging, or Packed status can be merged.");
            }

            // Merge Items
            for (const sourceItem of sourceOrder.items) {
                const { variantId, quantity, price, sellUnit, productId, variantInfo, discount } = sourceItem;

                const targetItem = targetOrder.items.find(
                    item => item.variantId === variantId && item.sellUnit === sellUnit
                );

                if (targetItem) {
                    const newQty = Number(targetItem.quantity) + Number(quantity);
                    const newDiscount = Number(targetItem.discount || 0) + Number(discount || 0);
                    
                    const newPrice = ((Number(targetItem.price) * Number(targetItem.quantity)) + 
                                      (Number(price) * Number(quantity))) / newQty;

                    await targetItem.update({
                        quantity: newQty,
                        price: newPrice.toFixed(2),
                        discount: newDiscount.toFixed(2)
                    }, { transaction: t });
                } else {
                    await sourceItem.update({ orderId: targetOrder.id }, { transaction: t });
                }
            }

            // Combine paid amount and notes
            newPaidAmount += Number(sourceOrder.paidAmount || 0);
            if (sourceOrder.notes) {
                combinedNotes.push(sourceOrder.notes);
            }

            await sourceOrder.destroy({ transaction: t });
        }

        // Recalculate Target Order Totals
        const updatedTargetItems = await OrderItem.findAll({
            where: { orderId: targetOrder.id },
            transaction: t
        });

        let newSubtotal = 0;
        let newTotalDiscount = 0;
        for (const item of updatedTargetItems) {
            newSubtotal += Number(item.price) * Number(item.quantity);
            newTotalDiscount += Number(item.discount || 0) * Number(item.quantity);
        }

        const settings = await AppSettings.findOne({ transaction: t });
        let newDeliveryCharge = 0;
        const deliveryMode = targetOrder.deliveryMode || 'Outlet';
        
        if (settings && newSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
            if (deliveryMode === 'Express') newDeliveryCharge = parseFloat(settings.expressDeliveryCharge || 0);
            else if (deliveryMode === 'Round') newDeliveryCharge = parseFloat(settings.deliveryOnRoundCharge || 0);
        }

        const newTotalAmount = roundTotal(newSubtotal + newDeliveryCharge);
        const newDueAmount = Math.max(0, newTotalAmount - newPaidAmount);

        let mergedStatus = targetOrder.orderStatus;
        if (targetStatus && allowedStatuses.includes(targetStatus)) {
            mergedStatus = targetStatus;
        }

        await targetOrder.update({
            totalAmount: newTotalAmount,
            paidAmount: newPaidAmount,
            dueAmount: newDueAmount,
            discount: newTotalDiscount,
            deliveryCharge: newDeliveryCharge,
            orderStatus: mergedStatus,
            isMerged: true,
            notes: combinedNotes.filter(Boolean).join('\n')
        }, { transaction: t });

        await t.commit();

        try {
            const user = await User.findByPk(targetOrder.userId);
            if (user && user.fcmtoken) {
                const title = 'Orders Merged!';
                const body = `Hey ${user.fullname || 'Customer'}, your orders have been merged into order #${targetOrder.orderId}.`;
                await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(targetOrder.id), orderId: String(targetOrder.id) });
                await Notification.create({
                    title,
                    body,
                    type: 'ORDER',
                    target: String(targetOrder.userId),
                    status: 'SENT',
                    clickAction: String(targetOrder.id)
                });
            }
        } catch (pushErr) {
            console.error('[Merge Orders Push Error]:', pushErr);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, `Orders merged successfully into ${targetOrder.orderId}.`, targetOrder);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

/**
 * @desc    Get all mergeable orders for the customer
 * @route   GET /api/godown-panel/sales/:id/mergeable
 * @access  Private (GodownStaff)
 */
export const getGodownMergeableOrders = async (req, res, next) => {
    try {
        const staff = req.user;
        const { id } = req.params;
        const order = await Order.findOne({
            where: {
                id,
                godownId: staff.godownId
            }
        });
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found or not in your godown.");
        }

        const where = {
            id: { [Op.ne]: id },
            orderStatus: { [Op.in]: ['Pending', 'Packaging', 'Packed'] },
            godownId: staff.godownId
        };

        if (order.userId) {
            where.userId = order.userId;
        } else {
            where.userId = null;
            where.customerName = order.customerName;
            where.customerNumber = order.customerNumber;
        }

        const mergeableOrders = await Order.findAll({
            where,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'mainCategoryId'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Mergeable orders fetched successfully.", mergeableOrders);
    } catch (error) {
        next(error);
    }
};


