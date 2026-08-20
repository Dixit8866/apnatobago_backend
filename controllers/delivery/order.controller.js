import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, Volume, OrderPayment, InventoryStock, SalesReturn, Notification, BusinessProfile } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { sendToDevice } from '../../services/notification.service.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { getTodayRangeIST } from './dashboard.controller.js';
import { uploadToS3 } from '../../utils/aws.s3.js';

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
        const { status, search, date } = req.query; // 'Pending', 'Assigned', 'Cancelled', 'Completed'
        logger.info(`[Get My Assigned Orders]: Fetching orders for delivery boy ${deliveryBoyId}, status: ${status || 'Any'}, date: ${date || 'Today'}`);

        const whereClause = { deliveryBoyId };
        const orderIncludeWhere = {};

        let todayStart, todayEnd;
        if (date) {
            const selectDate = new Date(date);
            const year = selectDate.getFullYear();
            const month = selectDate.getMonth();
            const day = selectDate.getDate();
            const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
            todayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
            todayEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
        } else {
            const todayRange = getTodayRangeIST();
            todayStart = todayRange.todayStart;
            todayEnd = todayRange.todayEnd;
        }

        // ── DEBUG ─────────────────────────────────────────────────────────────
        const toIST = (d) => new Date(d.getTime() + (5.5 * 60 * 60 * 1000))
            .toISOString().replace('T', ' ').slice(0, 19) + ' IST';
        // ─────────────────────────────────────────────────────────────────────

        if (status) {
            if (status === 'Cancelled') {
                // Use ONLY order.updatedAt - assignment.updatedAt is unreliable (bulk reset)
                // Match: order was cancelled TODAY (by its own updatedAt, not assignment's)
                whereClause['$order.orderStatus$'] = { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
                orderIncludeWhere.updatedAt = { [Op.between]: [todayStart, todayEnd] };

            } else if (status === 'Completed') {
                // Use ONLY order.updatedAt - assignment.updatedAt is unreliable (bulk reset)
                // Match: order was delivered/completed TODAY (by order's own updatedAt)
                whereClause['$order.orderStatus$'] = { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] };
                orderIncludeWhere.updatedAt = { [Op.between]: [todayStart, todayEnd] };

            } else if (status === 'Assigned' || status === 'Pending') {
                // If a date is selected, filter by order.createdAt on that day
                // If no date, show ALL pending/assigned (any date) - existing behaviour
                whereClause.status = status;
                orderIncludeWhere.orderStatus = {
                    [Op.notIn]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
                };
                if (date) {
                    // Apply the selected date to order's createdAt
                    orderIncludeWhere.createdAt = { [Op.between]: [todayStart, todayEnd] };
                }
            } else {
                whereClause.status = status;
            }
        } else {
            // Default: show ALL pending/assigned (any date) + TODAY's completed + TODAY's cancelled
            // Use order.updatedAt for date filtering (assignment.updatedAt is unreliable - gets bulk reset)
            whereClause[Op.or] = [
                {
                    // Branch 1: active pending/assigned - order NOT in terminal status
                    status: { [Op.in]: ['Pending', 'Assigned'] },
                    '$order.orderStatus$': {
                        [Op.notIn]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
                    }
                },
                {
                    // Branch 2: order delivered/paid TODAY (by order's own updatedAt)
                    '$order.orderStatus$': { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                    '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
                },
                {
                    // Branch 3: order cancelled TODAY (by order's own updatedAt)
                    '$order.orderStatus$': { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] },
                    '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
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
                        {
                            model: User,
                            as: 'user',
                            attributes: ['fullname', 'number', 'city', 'postcode', 'latitude', 'longitude'],
                            include: [
                                {
                                    model: BusinessProfile,
                                    as: 'businessProfile',
                                    attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                                }
                            ]
                        }
                    ]
                }
            ],
            ...(req.query.paginate !== 'false' ? { limit, offset } : {}),
            // Pending/Assigned: oldest order first (ASC). Completed/Cancelled: latest first (DESC)
            order: [['position', 'ASC'], ['assignedAt', 'ASC']],
            subQuery: false
        });

        // ── DEBUG: Print every returned row ───────────────────────────────────
        result.rows.forEach((row, i) => {
            const o = row.order;
            const updatedIST = row.updatedAt ? toIST(new Date(row.updatedAt)) : 'N/A';
            const orderUpdatedIST = o?.updatedAt ? toIST(new Date(o.updatedAt)) : 'N/A';
            const assignedIST = row.assignedAt ? toIST(new Date(row.assignedAt)) : 'N/A';
        });
        // ─────────────────────────────────────────────────────────────────────

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
                        const rawItems = itemsMap[item.order.id] || [];
                        const formattedItems = rawItems.map(it => {
                            const itemData = it.toJSON ? it.toJSON() : it;
                            if (itemData.variantInfo) {
                                if (typeof itemData.variantInfo.volume === 'object' && itemData.variantInfo.volume !== null) {
                                    itemData.variantInfo.volume = Object.values(itemData.variantInfo.volume)[0] || '';
                                }
                                if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
                                if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
                            }
                            return itemData;
                        });
                        item.order.setDataValue('items', formattedItems);
                    }
                });
            }
        }

        let responseData;
        if (req.query.paginate !== 'false') {
            responseData = formatPaginatedResponse(result, page, limit);
        } else {
            responseData = {
                totalRecords: result.count,
                data: result.rows
            };
        }

        if (responseData.data) {
            responseData.data = responseData.data.map(item => {
                const data = item.toJSON ? item.toJSON() : item;
                if (data.order && data.order.orderStatus === 'Cancelled') {
                    data.status = 'Cancelled';
                }
                if (data.order && data.order.user) {
                    data.order.user.shopName = data.order.user.businessProfile?.shopName || '';
                    data.order.user.shopAddress = data.order.user.businessProfile?.shopAddress || '';
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
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'latitude', 'longitude'],
                            include: [
                                {
                                    model: BusinessProfile,
                                    as: 'businessProfile',
                                    attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                                }
                            ]
                        },
                        { model: OrderPayment, as: 'payments' },
                        {
                            model: OrderItem,
                            as: 'items',
                            include: [
                                { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'hasCoupon', 'couponPoints', 'couponPrice'] },
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

        if (data.order && data.order.user) {
            data.order.user.shopName = data.order.user.businessProfile?.shopName || '';
            data.order.user.shopAddress = data.order.user.businessProfile?.shopAddress || '';
        }

        // Sanitize variantInfo in items & extract couponProducts
        const couponProducts = [];

        if (data.order && data.order.items) {
            data.order.items.forEach(itemData => {
                const p = itemData.product || {};
                const isItemCouponApplied = itemData.hasCoupon === true || itemData.hasCoupon === 'true';
                
                itemData.hasCoupon = isItemCouponApplied;
                itemData.couponPoints = isItemCouponApplied ? Number(itemData.couponPoints || 0) : 0;
                itemData.couponPrice = isItemCouponApplied ? parseFloat(itemData.couponPrice || 0).toFixed(2) : "0.00";

                if (itemData.variantInfo) {
                    if (typeof itemData.variantInfo.volume === 'object' && itemData.variantInfo.volume !== null) {
                        itemData.variantInfo.volume = Object.values(itemData.variantInfo.volume)[0] || '';
                    }
                    if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
                    if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
                }

                const masterHasCoupon = p.hasCoupon === true || p.hasCoupon === 'true';
                if (masterHasCoupon) {
                    const masterPts = Number(p.couponPoints || 0);
                    const masterPrice = Number(p.couponPrice || 0);

                    let pName = p.name;
                    if (typeof pName === 'object' && pName !== null) {
                        pName = pName.en || Object.values(pName)[0] || 'Product';
                    }

                    couponProducts.push({
                        id: itemData.productId,
                        itemId: itemData.id,
                        name: pName || itemData.productName || 'Product',
                        image: p.thumbnail || '',
                        couponPoints: masterPts,
                        couponPrice: masterPrice.toFixed(2)
                    });
                }
            });
        }

        const isSettled = ['Delivered', 'Payment Collect', 'Payment Verify'].includes(assignment.order?.orderStatus);
        const savedCouponPts = isSettled ? Number(assignment.order?.couponPoints || 0) : 0;
        const savedCouponDisc = isSettled ? parseFloat(assignment.order?.couponDiscount || 0) : 0;
        const fullTotal = parseFloat(assignment.order?.totalAmount || 0);
        const paidAmount = parseFloat(assignment.order?.paidAmount || 0);
        const payableAmt = Math.max(0, fullTotal - savedCouponDisc);
        const calculatedDueAmt = Math.max(0, payableAmt - paidAmount);

        delete data.payableAmount; // Remove duplicate top-level field

        if (data.order) {
            data.order.couponPoints = savedCouponPts;
            data.order.couponDiscount = savedCouponDisc.toFixed(2);
            data.order.discountType = (savedCouponPts > 0 || savedCouponDisc > 0) ? (assignment.order?.discountType || 'Coupon Discount') : null;
            data.order.couponProducts = couponProducts;
            data.order.payableAmount = payableAmt.toFixed(2);
            data.order.paidAmount = paidAmount.toFixed(2);
            data.order.dueAmount = calculatedDueAmt.toFixed(2);
            data.order.totalAmount = fullTotal.toFixed(2);
        }

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
        data.currentOrderAmount = calculatedDueAmt.toFixed(2);
        data.grandTotalAmount = (parseFloat(totalPastDueAmount) + calculatedDueAmt).toFixed(2);

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
                order.deliveredAt = order.deliveredAt || new Date();
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
            await Order.update({ orderStatus: 'Delivered', deliveredAt: Order.sequelize.literal('COALESCE("deliveredAt", NOW())') }, { where: { id: assignment.orderId } });
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
            notes,
            totalCouponPoints,
            couponPoints,
            totalCouponPrice,
            couponDiscount,
            couponPrice,
            discountType,
            couponItems
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

        // Handle product-wise coupon items if sent by Delivery Boy App
        let calcCouponPts = null;
        let calcCouponDisc = null;

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

        // Calculate actual sum of all coupon items in this order
        const allOrderItems = await OrderItem.findAll({
            where: { orderId: assignment.order.id },
            transaction: t
        });

        const totalOrderCouponPts = allOrderItems.reduce((sum, item) => sum + Number(item.couponPoints || 0), 0);
        const totalOrderCouponDisc = allOrderItems.reduce((sum, item) => sum + parseFloat(item.couponPrice || 0), 0);

        // Check if top-level coupon parameters were sent in req.body
        const passedDisc = couponDiscount !== undefined ? parseFloat(couponDiscount) : (totalCouponPrice !== undefined ? parseFloat(totalCouponPrice) : (couponPrice !== undefined ? parseFloat(couponPrice) : 0));
        const passedPts = couponPoints !== undefined ? Number(couponPoints) : (totalCouponPoints !== undefined ? Number(totalCouponPoints) : 0);

        const existingCouponPts = Number(assignment.order?.couponPoints || 0);
        const existingCouponDisc = parseFloat(assignment.order?.couponDiscount || 0);

        // Final coupon discount is either sum of all items or accumulated top-level discount
        const finalCouponPts = Math.max(totalOrderCouponPts, existingCouponPts + passedPts);
        const finalCouponDisc = Math.max(totalOrderCouponDisc, existingCouponDisc + passedDisc);

        if (assignment.order) {
            assignment.order.couponPoints = finalCouponPts;
            assignment.order.couponDiscount = finalCouponDisc.toFixed(2);
            assignment.order.discountType = (finalCouponPts > 0 || finalCouponDisc > 0) ? (discountType || 'Coupon Discount') : null;

            // Adjust order's dueAmount to reflect net bill after total cumulative coupon discount
            const netPayableBill = Math.max(0, parseFloat(assignment.order.totalAmount || 0) - finalCouponDisc);
            const netDueBeforePayment = Math.max(0, netPayableBill - parseFloat(assignment.order.paidAmount || 0));
            assignment.order.dueAmount = netDueBeforePayment.toFixed(2);
            await assignment.order.save({ transaction: t });
        }

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
        // ─── DIRECT BANK TRANSFER DOUBLE-COUNTING PREVENTION ──────────────────────
        // Check if there is an existing, pending Direct Bank Transfer payment for this order
        const existingBankPayment = await OrderPayment.findOne({
            where: {
                orderId: assignment.order.id,
                paymentMethod: 'ONLINE',
                onlineType: 'Bank Account'
            },
            transaction: t
        });
        // ─────────────────────────────────────────────────────────────────────────────

        for (const order of ordersToSettle) {
            let due = parseFloat(order.dueAmount);
            if (due <= 0) continue;

            let orderNotes = [];
            let paymentMethodsUsed = [];

            // Apply existing bank transfer payment first to reduce due amount without creating a duplicate payment entry
            if (order.id === assignment.order.id && existingBankPayment) {
                const appliedAmt = Math.min(parseFloat(existingBankPayment.amount), due);
                due -= appliedAmt;
                order.paidAmount = parseFloat(order.paidAmount) + appliedAmt;
                orderNotes.push(`Paid ${appliedAmt} via Direct Bank Transfer (Awaiting Verification)`);
                paymentMethodsUsed.push('ONLINE');
                remainingOnline = Math.max(0, remainingOnline - appliedAmt);
                logger.info(`[Complete Order Settle]: Applied existing bank transfer payment of ${appliedAmt} to order ${order.id}.`);
            }

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

            // Synchronize existing CREDIT payment entry in OrderPayment table to match exact remaining due balance
            const existingCreditPayment = await OrderPayment.findOne({
                where: { orderId: order.id, paymentMethod: 'CREDIT' },
                transaction: t
            });
            if (existingCreditPayment) {
                if (due <= 1e-7) {
                    await existingCreditPayment.destroy({ transaction: t });
                } else {
                    await existingCreditPayment.update({ amount: due.toFixed(2) }, { transaction: t });
                }
            }

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
            { orderStatus: 'Payment Collect', deliveredAt: Order.sequelize.literal('COALESCE("deliveredAt", NOW())') },
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

/**
 * @desc    Delivery boy submits bank payment proof (screenshot) for an order
 * @route   POST /api/delivery/user/orders/:id/bank-payment
 * @access  Private (Delivery Boy)
 */
export const submitDeliveryBankPayment = async (req, res) => {
    const t = await OrderAssignment.sequelize.transaction();
    try {
        const { id } = req.params;
        const { bankSettingId, screenshot, transactionId, amount } = req.body;
        const deliveryBoyId = req.user.id; // Authenticated delivery boy

        // 1. Find the order (Support both UUID primary key and human-readable orderId e.g. '1006')
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const orderWhere = {};
        if (isUUID) {
            orderWhere.id = id;
        } else {
            orderWhere.orderId = id;
        }

        const order = await Order.findOne({
            where: orderWhere,
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // 2. Validate bank account selection
        if (!bankSettingId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Bank account selection is required.");
        }

        let finalScreenshot = screenshot || null;

        // 3. Extract file if uploaded via multipart/form-data (req.files or req.file)
        const file = req.files?.image?.[0] || req.files?.screenshot?.[0] || req.file;
        if (file) {
            const uploadResult = await uploadToS3(file.buffer, file.originalname, file.mimetype);
            if (uploadResult.success) {
                finalScreenshot = uploadResult.url;
            } else {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to upload payment screenshot to S3.");
            }
        }

        // 4. Create the OrderPayment record (Screenshot is optional)
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
            isSubmitted: false, // Unverified, waits for admin approval in the admin panel
            notes: 'Submitted via Delivery Boy App'
        }, { transaction: t });

        // 5. Find the active assignment and complete it
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
                notes: 'Settled via Direct Bank Transfer in Delivery Boy App'
            }, { transaction: t });
        }

        // 7. Settle/Update the Order status to 'Payment Verify' since payment proof is submitted and needs verification
        // Also set deliveredAt since the order has been delivered
        await order.update({
            orderStatus: 'Payment Verify',
            deliveredAt: order.deliveredAt || new Date()
        }, { transaction: t });

        await t.commit();

        // 8. Trigger Delivered Push Notification
        await sendDeliveredNotification(order.id);

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Payment proof submitted and order settled successfully. Waiting for admin verification.", payment);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Delivery Submit Bank Payment Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
