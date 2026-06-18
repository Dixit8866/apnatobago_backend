import { Op } from 'sequelize';
import { Order, OrderItem, Product, ProductVariant, User, Volume, OrderAssignment, DeliveryBoy, BusinessProfile, OrderPayment, InventoryStock, SalesReturn, Notification, AppSettings, RouteCategory } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { generateOrderInvoice, generateDeliveryLabel, generateDeliveryLabelHTML } from '../../utils/invoiceGenerator.js';
import { sendToDevice } from '../../services/notification.service.js';
import { roundTotal } from '../../utils/roundHelper.js';
// ... (rest of imports)

const adjustOrderPayments = (order) => {
    if (!order) return order;

    const rowData = order.toJSON ? order.toJSON() : order;
    if (!rowData.payments || rowData.payments.length === 0) return rowData;

    let payments = rowData.payments.map(p => p.toJSON ? p.toJSON() : { ...p });

    // If the order is in "Payment Collect" status, ONLY show payments currently pending verification (isSubmitted = false)
    if (rowData.orderStatus === 'Payment Collect') {
        payments = payments.filter(p => !p.isSubmitted);
    }

    const totalCredit = payments.filter(p => p.paymentMethod === 'CREDIT').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalReal = payments.filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const orderTotal = parseFloat(rowData.totalAmount || 0);

    const nonCreditPortion = Math.max(0, orderTotal - totalCredit);
    const realPaidToCredit = Math.max(0, totalReal - nonCreditPortion);
    const outstandingCredit = Math.max(0, totalCredit - realPaidToCredit);

    let remainingCreditToDistribute = outstandingCredit;

    const adjustedPayments = payments.map(payment => {
        if (payment.paymentMethod === 'CREDIT') {
            const currentAmount = parseFloat(payment.amount || 0);
            const allowedAmount = Math.min(currentAmount, remainingCreditToDistribute);
            remainingCreditToDistribute -= allowedAmount;
            return {
                ...payment,
                amount: allowedAmount.toFixed(2)
            };
        }
        return payment;
    }).filter(p => parseFloat(p.amount) > 0);

    rowData.payments = adjustedPayments;
    return rowData;
};

/**
 * @desc    Generate Delivery Label PDF
 * @route   GET /api/admin/orders/:id/delivery-label
 * @access  Private (Admin)
 */
export const downloadDeliveryLabel = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'user' },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy' }]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // Return HTML if requested
        if (req.query.format === 'html') {
            const html = generateDeliveryLabelHTML(order);
            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        }

        const pdfBuffer = await generateDeliveryLabel(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Label-${order.orderId}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error(`[Admin Label Generation Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};


/**
 * @desc    Get all orders for admin
 * @route   GET /api/admin/orders
 * @access  Private (Admin)
 */
export const getAllOrders = async (req, res) => {
    try {
        const { status, date, search, deliveryBoyId, startDate, endDate, userId, routeCategoryId } = req.query;
        const where = { saleType: 'Online' }; // Strictly filter online user orders to exclude direct admin/POS sales

        // Pre-fetch settings to resolve any empty deliveryRoundTiming
        const appSettings = await AppSettings.findOne();
        const rawSchedules = appSettings && Array.isArray(appSettings.deliveryRoundSchedules) ? appSettings.deliveryRoundSchedules : [];
        const normalizedSchedules = rawSchedules.map((round, index) => ({
            id: round.id || `round_${index + 1}`,
            ...round
        }));

        if (userId) {
            where.userId = userId;
        }

        if (search) {
            where[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerNumber: { [Op.iLike]: `%${search}%` } },
                { '$user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$user.number$': { [Op.iLike]: `%${search}%` } },
                { '$user.city$': { [Op.iLike]: `%${search}%` } },
                { '$user.businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$assignment.deliveryBoy.name$': { [Op.iLike]: `%${search}%` } },
                { '$assignment.deliveryBoy.phone$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        // Helper to get today's 24-hour date range in India Standard Time (IST)
        const getISTTodayRange = () => {
            const now = new Date();
            // Offset to IST (+5.5 hours)
            const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

            const startOfIstToday = new Date(istTime);
            startOfIstToday.setUTCHours(0, 0, 0, 0);
            const startOfTodayUTC = new Date(startOfIstToday.getTime() - (5.5 * 60 * 60 * 1000));

            const endOfIstToday = new Date(istTime);
            endOfIstToday.setUTCHours(23, 59, 59, 999);
            const endOfTodayUTC = new Date(endOfIstToday.getTime() - (5.5 * 60 * 60 * 1000));

            return { startOfTodayUTC, endOfTodayUTC };
        };

        const { startOfTodayUTC, endOfTodayUTC } = getISTTodayRange();
        const dateFilterField = status === 'Delivered' ? 'deliveredAt' : (status === 'Cancelled' ? 'updatedAt' : 'createdAt');

        // Apply status filter
        if (status && status !== 'All') {
            if (status === 'Delivered') {
                where.orderStatus = { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] };
                // Restrict Delivered/Payment Collect/Payment Verify to today by default unless filtered
                if (!startDate && !endDate && !date) {
                    where[Op.or] = [
                        { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                        { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
                    ];
                }
            } else if (status === 'Cancelled') {
                where.orderStatus = { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
                // Restrict Cancelled orders to today by default unless filtered
                if (!startDate && !endDate && !date) {
                    where.updatedAt = { [Op.between]: [startOfTodayUTC, endOfTodayUTC] };
                }
            } else if (status === 'Pending Due Order') {
                where.paymentStatus = { [Op.ne]: 'Paid' };
                where.orderStatus = { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
            } else {
                where.orderStatus = status;
            }
        }

        // Apply date / date range filters
        if (startDate && endDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(endDate);
            endOfDate.setHours(23, 59, 59, 999);
            if (dateFilterField === 'deliveredAt') {
                where[Op.or] = [
                    { deliveredAt: { [Op.between]: [startOfDate, endOfDate] } },
                    { deliveredAt: null, updatedAt: { [Op.between]: [startOfDate, endOfDate] } }
                ];
            } else {
                where[dateFilterField] = { [Op.between]: [startOfDate, endOfDate] };
            }
        } else if (startDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(startDate);
            endOfDate.setHours(23, 59, 59, 999);
            if (dateFilterField === 'deliveredAt') {
                where[Op.or] = [
                    { deliveredAt: { [Op.between]: [startOfDate, endOfDate] } },
                    { deliveredAt: null, updatedAt: { [Op.between]: [startOfDate, endOfDate] } }
                ];
            } else {
                where[dateFilterField] = { [Op.between]: [startOfDate, endOfDate] };
            }
        } else if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            if (dateFilterField === 'deliveredAt') {
                where[Op.or] = [
                    { deliveredAt: { [Op.between]: [startOfDay, endOfDay] } },
                    { deliveredAt: null, updatedAt: { [Op.between]: [startOfDay, endOfDay] } }
                ];
            } else {
                where[dateFilterField] = { [Op.between]: [startOfDay, endOfDay] };
            }
        }

        // Apply delivery boy filter
        if (deliveryBoyId) {
            where['$assignment.deliveryBoyId$'] = deliveryBoyId;
        }

        // Apply route category filter
        if (routeCategoryId) {
            where.routeCategoryId = routeCategoryId;
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Order.findAndCountAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name', 'phone'] }]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        // Fetch and attach one-to-many associations (items and payments) for the paginated subset of orders
        if (result.rows.length > 0) {
            const orderIds = result.rows.map(o => o.id);

            // Fetch OrderItems with nested product, variant, and volumes
            const items = await OrderItem.findAll({
                where: { orderId: orderIds },
                include: [
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'thumbnail'],
                        include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                    },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                        include: [
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                        ]
                    }
                ]
            });

            // Fetch OrderPayments
            const payments = await OrderPayment.findAll({
                where: { orderId: orderIds },
                attributes: ['id', 'amount', 'paymentMethod', 'isSubmitted', 'submittedAt', 'orderId']
            });

            // Fetch SalesReturns
            const returns = await SalesReturn.findAll({
                where: { orderId: orderIds },
                include: [
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'thumbnail'],
                        include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                    },
                    { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'] }
                ]
            });

            // Group items, payments, and returns by orderId
            const itemsMap = {};
            items.forEach(item => {
                const oId = item.orderId;
                if (!itemsMap[oId]) itemsMap[oId] = [];
                itemsMap[oId].push(item);
            });

            const paymentsMap = {};
            payments.forEach(p => {
                const oId = p.orderId;
                if (!paymentsMap[oId]) paymentsMap[oId] = [];
                paymentsMap[oId].push(p);
            });

            const returnsMap = {};
            returns.forEach(r => {
                const oId = r.orderId;
                if (!returnsMap[oId]) returnsMap[oId] = [];
                returnsMap[oId].push(r);
            });

            // Attach to Sequelize models using setDataValue so they are serialized correctly
            result.rows.forEach(order => {
                if (order.deliveryMode === 'Round' && order.deliveryRoundId && !order.deliveryRoundTiming) {
                    const matchedRound = normalizedSchedules.find(r => r.id === order.deliveryRoundId);
                    if (matchedRound) {
                        order.setDataValue('deliveryRoundTiming', matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`);
                    }
                }
                order.setDataValue('items', itemsMap[order.id] || []);
                order.setDataValue('payments', paymentsMap[order.id] || []);
                order.setDataValue('returns', returnsMap[order.id] || []);
            });
        }

        // ── Calculate Dynamic Status Counts for Tab Badges ────────────────────────
        const countWhere = { saleType: 'Online' };
        const countInclude = [];

        if (routeCategoryId) {
            countWhere.routeCategoryId = routeCategoryId;
        }

        if (deliveryBoyId) {
            countWhere['$assignment.deliveryBoyId$'] = deliveryBoyId;
            countInclude.push({
                model: OrderAssignment,
                as: 'assignment'
            });
        }

        let countDateRange = null;
        if (startDate && endDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(endDate);
            endOfDate.setHours(23, 59, 59, 999);
            countDateRange = { [Op.between]: [startOfDate, endOfDate] };
        } else if (startDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(startDate);
            endOfDate.setHours(23, 59, 59, 999);
            countDateRange = { [Op.between]: [startOfDate, endOfDate] };
        } else if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            countDateRange = { [Op.between]: [startOfDay, endOfDay] };
        }

        // Setup count filters
        const isDateFiltered = !!(startDate || endDate || date);
        const pendingCountWhere = { ...countWhere, orderStatus: 'Pending' };
        const packagingCountWhere = { ...countWhere, orderStatus: 'Packaging' };
        const packedCountWhere = { ...countWhere, orderStatus: 'Packed' };
        const shippingCountWhere = { ...countWhere, orderStatus: 'Shipping' };

        const deliveredCountWhere = { ...countWhere, orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] } };
        const paymentCollectCountWhere = { ...countWhere, orderStatus: 'Payment Collect' };
        const paymentVerifyCountWhere = { ...countWhere, orderStatus: 'Payment Verify' };
        const cancelledCountWhere = { ...countWhere, orderStatus: { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] } };

        const pendingDueCountWhere = {
            ...countWhere,
            paymentStatus: { [Op.ne]: 'Paid' },
            orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
        };

        if (isDateFiltered && countDateRange) {
            pendingCountWhere.createdAt = countDateRange;
            packagingCountWhere.createdAt = countDateRange;
            packedCountWhere.createdAt = countDateRange;
            shippingCountWhere.createdAt = countDateRange;
            pendingDueCountWhere.createdAt = countDateRange;

            deliveredCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            paymentCollectCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            paymentVerifyCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            cancelledCountWhere.updatedAt = countDateRange;
        } else {
            // Restrict Delivered and Cancelled badges to today in IST by default if no active date filter is set
            deliveredCountWhere[Op.or] = [
                { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
            ];
            paymentCollectCountWhere[Op.or] = [
                { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
            ];
            paymentVerifyCountWhere[Op.or] = [
                { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
            ];
            cancelledCountWhere.updatedAt = { [Op.between]: [startOfTodayUTC, endOfTodayUTC] };
        }

        const [pendingCount, packagingCount, packedCount, shippingCount, deliveredCount, paymentCollectCount, paymentVerifyCount, cancelledCount, todayCount, salesReturnCount, pendingDueCount] = await Promise.all([
            Order.count({ where: pendingCountWhere, include: countInclude }),
            Order.count({ where: packagingCountWhere, include: countInclude }),
            Order.count({ where: packedCountWhere, include: countInclude }),
            Order.count({ where: shippingCountWhere, include: countInclude }),
            Order.count({ where: deliveredCountWhere, include: countInclude }),
            Order.count({ where: paymentCollectCountWhere, include: countInclude }),
            Order.count({ where: paymentVerifyCountWhere, include: countInclude }),
            Order.count({ where: cancelledCountWhere, include: countInclude }),
            Order.count({ where: { ...countWhere, createdAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }, include: countInclude }),
            SalesReturn.count({ where: deliveryBoyId ? { deliveryBoyId } : {} }),
            Order.count({ where: pendingDueCountWhere, include: countInclude })
        ]);

        // Calculate dynamic order counts by routeCategory for the currently active tab status and date filter
        const routeCountWhere = { ...where };
        delete routeCountWhere.routeCategoryId;
        routeCountWhere.routeCategoryId = { [Op.ne]: null };

        const routeCountInclude = [];
        if (deliveryBoyId) {
            routeCountInclude.push({
                model: OrderAssignment,
                as: 'assignment'
            });
        }

        const routeCountsRaw = await Order.count({
            where: routeCountWhere,
            include: routeCountInclude,
            group: ['routeCategoryId']
        });

        const routeCounts = {};
        if (Array.isArray(routeCountsRaw)) {
            routeCountsRaw.forEach(r => {
                const id = r.routeCategoryId;
                if (id) {
                    routeCounts[id] = parseInt(r.count || 0, 10);
                }
            });
        }

        const responseData = formatPaginatedResponse(result, page, limit);
        responseData.routeCounts = routeCounts;

        // Attach counts to response
        responseData.statusCounts = {
            '': responseData.totalRecords,
            Today: todayCount,
            Pending: pendingCount,
            Packaging: packagingCount,
            Packed: packedCount,
            Shipping: shippingCount,
            Delivered: deliveredCount,
            'Payment Collect': paymentCollectCount,
            'Payment Verify': paymentVerifyCount,
            Cancelled: cancelledCount,
            SalesReturn: salesReturnCount,
            'Pending Due Order': pendingDueCount
        };

        if (responseData.orders) {
            responseData.orders = responseData.orders.map(order => adjustOrderPayments(order));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "All orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Admin Get Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update order status
 * @route   PUT /api/admin/orders/:id/status
 * @access  Private (Admin)
 */
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderStatus, paymentStatus, paidAmount: newPaidAmount, notes } = req.body;

        const order = await Order.findByPk(id);

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const prevStatus = order.orderStatus;
        if (orderStatus) {
            const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
            if (!validStatuses.includes(orderStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
            }
            if (orderStatus === 'Cancelled') {
                order.orderStatus = 'Admin Cancel';
                order.deliveredAt = null;
            } else {
                order.orderStatus = orderStatus;
                if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) {
                    order.deliveredAt = order.deliveredAt || new Date();
                } else {
                    order.deliveredAt = null;
                }
            }

            if (notes) {
                const timestamp = new Date().toLocaleString();
                const prefix = (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') ? `[Cancelled on ${timestamp}] Reason: ` : `[Status ${orderStatus} on ${timestamp}]: `;
                order.notes = order.notes ? `${order.notes}\n${prefix}${notes}` : `${prefix}${notes}`;
            }

            // If moving to verified status, auto-submit any pending payments
            if (orderStatus === 'Payment Verify' || orderStatus === 'Delivered') {
                await OrderPayment.update(
                    { isSubmitted: true, submittedAt: new Date() },
                    { where: { orderId: order.id, isSubmitted: false } }
                );
            }

            // If cancelled, also cancel associated assignment if exists
            if (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') {
                const OrderAssignment = order.sequelize.models.OrderAssignment;
                if (OrderAssignment) {
                    await OrderAssignment.update(
                        { status: 'Cancelled', notes: notes || 'Cancelled by Admin' },
                        { where: { orderId: order.id } }
                    );
                }

                // If the order was already shipped, convert cancel into SalesReturn entries (Pending)
                // and DO NOT restore inventory until admin approves the sales return.
                if (prevStatus === 'Shipping') {
                    // Create sales return entries for all order items and remove them
                    const assignment = await OrderAssignment.findOne({ where: { orderId: order.id } });
                    const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;
                    let totalReturnAmount = 0;

                    const orderItemsToProcess = await OrderItem.findAll({ where: { orderId: order.id } });
                    for (const item of orderItemsToProcess) {
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
                            reason: 'Cancelled after shipping (Admin)',
                            status: 'Pending'
                        });

                        totalReturnAmount += returnAmount;
                        await item.destroy();
                    }

                    // Recalculate order totals
                    const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                    let newSubtotal = 0;
                    for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                    order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                    order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                    await order.save();
                } else {
                    // Restore inventory stock for all order items (existing behaviour)
                    const orderItemsToRestore = await OrderItem.findAll({ where: { orderId: order.id } });
                    for (const item of orderItemsToRestore) {
                        const variant = await ProductVariant.findByPk(item.variantId);
                        const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                        const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * sellingVolume * bUPP;

                        logger.info(`[Admin Cancel Restore]: orderId=${order.id}, productId=${item.productId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

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

        // Handle Payment Updates
        if (newPaidAmount !== undefined) {
            const total = parseFloat(order.totalAmount);
            const paid = parseFloat(newPaidAmount);

            order.paidAmount = paid;
            order.dueAmount = Math.max(0, total - paid);

            if (paid >= total) {
                order.paymentStatus = 'Paid';
            } else if (paid > 0) {
                order.paymentStatus = 'Partial';
            } else {
                order.paymentStatus = 'Pending';
            }
        } else if (paymentStatus) {
            const validPaymentStatuses = ['Pending', 'Paid', 'Partial', 'Failed', 'Refunded'];
            if (!validPaymentStatuses.includes(paymentStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid payment status.");
            }
            order.paymentStatus = paymentStatus;

            if (paymentStatus === 'Paid') {
                order.paidAmount = order.totalAmount;
                order.dueAmount = 0;
            } else if (paymentStatus === 'Pending') {
                order.paidAmount = 0;
                order.dueAmount = order.totalAmount;
            }
        }

        if (order.orderStatus === 'Cancelled' || order.orderStatus === 'Admin Cancel' || order.orderStatus === 'User Cancel' || order.orderStatus === 'Delivery Boy Cancel') {
            order.dueAmount = 0;
        }

        await order.save();

        // Trigger Shipping Push Notification if status changed to Shipping
        if (orderStatus === 'Shipping' && prevStatus !== 'Shipping') {
            try {
                const user = await User.findByPk(order.userId);
                if (user && user.fcmtoken) {
                    const title = 'Order Shipped!';
                    const body = `Hey ${user.fullname}, your order #${order.orderId} is in shipping!`;
                    await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
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
                console.error('[Shipping Push Notification Error]:', pushErr);
                logger.error(`[Shipping Push Notification Error]: ${pushErr.message}`);
            }
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order status updated successfully.", order);
    } catch (error) {
        logger.error(`[Admin Update Order Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk update order status
 * @route   PUT /api/admin/orders/bulk-status
 * @access  Private (Admin)
 */
export const bulkUpdateOrderStatus = async (req, res) => {
    try {
        const { orderIds, orderStatus } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
        if (!validStatuses.includes(orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
        }

        // Update all matching orders
        const ordersToCancel = await Order.findAll({
            where: { id: orderIds },
            include: [{ model: OrderItem, as: 'items' }]
        });

        const targetStatus = orderStatus === 'Cancelled' ? 'Admin Cancel' : orderStatus;
        const updateFields = { orderStatus: targetStatus };
        if (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') {
            updateFields.dueAmount = 0;
            updateFields.deliveredAt = null;
        } else if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) {
            updateFields.deliveredAt = new Date();
        } else {
            updateFields.deliveredAt = null;
        }

        await Order.update(
            updateFields,
            { where: { id: orderIds } }
        );

        // If cancelling, process each order: for shipped orders create SalesReturn (pending), otherwise restore inventory
        if (orderStatus === 'Cancelled') {
            const OrderAssignment = Order.sequelize.models.OrderAssignment;
            for (const cancelOrder of ordersToCancel) {
                if (!cancelOrder.items || cancelOrder.items.length === 0) continue;

                if (cancelOrder.orderStatus === 'Shipping') {
                    // Create sales returns and remove items
                    const assignment = OrderAssignment ? await OrderAssignment.findOne({ where: { orderId: cancelOrder.id } }) : null;
                    const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;
                    let totalReturn = 0;
                    for (const item of cancelOrder.items) {
                        const returnQty = Number(item.quantity);
                        const returnAmount = Number(item.price) * returnQty;
                        await SalesReturn.create({
                            orderId: cancelOrder.id,
                            userId: cancelOrder.userId,
                            deliveryBoyId,
                            productId: item.productId,
                            variantId: item.variantId,
                            volumeId: item.volumeId || null,
                            quantity: returnQty,
                            price: item.price,
                            returnAmount,
                            reason: 'Cancelled after shipping (Bulk Admin)',
                            status: 'Pending'
                        });
                        totalReturn += returnAmount;
                        await OrderItem.destroy({ where: { id: item.id } });
                    }

                    // Recalculate order totals
                    const remaining = await OrderItem.findAll({ where: { orderId: cancelOrder.id } });
                    let newSubtotal = 0;
                    for (const it of remaining) newSubtotal += Number(it.price) * Number(it.quantity);
                    const orderRecord = await Order.findByPk(cancelOrder.id);
                    orderRecord.totalAmount = roundTotal(newSubtotal + (Number(orderRecord.deliveryCharge) || 0));
                    orderRecord.dueAmount = Math.max(0, orderRecord.dueAmount - totalReturn);
                    await orderRecord.save();
                } else {
                    for (const item of cancelOrder.items) {
                        const variant = await ProductVariant.findByPk(item.variantId);
                        const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                        const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * sellingVolume * bUPP;

                        logger.info(`[Admin Bulk Cancel Restore]: orderId=${cancelOrder.id}, productId=${item.productId}, qty=${item.quantity}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

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

        // Trigger Shipping Push Notifications for bulk update if status is Shipping
        if (orderStatus === 'Shipping') {
            try {
                const updatedOrders = await Order.findAll({
                    where: { id: orderIds },
                    include: [{ model: User, as: 'user' }]
                });
                for (const order of updatedOrders) {
                    if (order.user && order.user.fcmtoken) {
                        const title = 'Order Shipped!';
                        const body = `Hey ${order.user.fullname}, your order #${order.orderId} is in shipping!`;
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
                }
            } catch (pushErr) {
                console.error('[Bulk Shipping Push Notification Error]:', pushErr);
                logger.error(`[Bulk Shipping Push Notification Error]: ${pushErr.message}`);
            }
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders status updated successfully.");
    } catch (error) {
        logger.error(`[Admin Bulk Update Order Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk verify payments and move to Delivered
 * @route   PUT /api/admin/orders/bulk-verify-payments
 * @access  Private (Admin)
 */
export const bulkVerifyPayments = async (req, res) => {
    try {
        const { orderIds, note } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const orders = await Order.findAll({ where: { id: orderIds } });

        for (const order of orders) {
            order.orderStatus = 'Payment Verify';
            order.paymentCollectStatus = 'Verified';
            order.deliveredAt = order.deliveredAt || new Date();

            if (note) {
                const timestamp = new Date().toLocaleString();
                const prefix = `[Payment Verified on ${timestamp}]: `;
                order.notes = order.notes ? `${order.notes}\n${prefix}${note}` : `${prefix}${note}`;
            }

            await order.save();

            // Auto-submit associated unsubmitted payments
            await OrderPayment.update(
                { isSubmitted: true, submittedAt: new Date() },
                { where: { orderId: order.id, isSubmitted: false } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payments verified and orders moved to Delivered successfully.");
    } catch (error) {
        logger.error(`[Admin Bulk Verify Payments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get single order details for admin
 * @route   GET /api/admin/orders/:id
 * @access  Private (Admin)
 */
export const getOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const isUUID = id.includes('-');
        const queryOption = isUUID ? { id } : { orderId: id };

        const order = await Order.findOne({
            where: queryOption,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'dialcode', 'applevel'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'thumbnail'],
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'purchasePrice', 'baseUnitsPerPack'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name', 'phone', 'vehicleNumber'] }]
                },
                {
                    model: OrderPayment,
                    as: 'payments',
                    attributes: ['id', 'amount', 'paymentMethod', 'isSubmitted', 'submittedAt']
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // Resolve deliveryRoundTiming dynamically if not set
        if (order.deliveryMode === 'Round' && order.deliveryRoundId && !order.deliveryRoundTiming) {
            const appSettings = await AppSettings.findOne();
            if (appSettings && Array.isArray(appSettings.deliveryRoundSchedules)) {
                const normalizedSchedules = appSettings.deliveryRoundSchedules.map((round, index) => ({
                    id: round.id || `round_${index + 1}`,
                    ...round
                }));
                const matchedRound = normalizedSchedules.find(r => r.id === order.deliveryRoundId);
                if (matchedRound) {
                    order.setDataValue('deliveryRoundTiming', matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`);
                }
            }
        }

        const adjustedOrder = adjustOrderPayments(order);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", adjustedOrder);
    } catch (error) {
        logger.error(`[Admin Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Generate Invoice PDF
 * @route   GET /api/admin/orders/:id/invoice
 * @access  Private (Admin)
 */
export const downloadInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'user' },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        { model: ProductVariant, as: 'variant' }
                    ]
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        { model: ProductVariant, as: 'variant' }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const pdfBuffer = await generateOrderInvoice(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${order.orderId}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error(`[Admin Invoice Generation Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update single order item quantity and price
 * @route   PUT /api/admin/orders/:id/items/:itemId
 * @access  Private (Admin)
 */
export const updateOrderItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { quantity, price, sellUnit, variantId } = req.body;

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const orderItem = await OrderItem.findOne({
            where: { id: itemId, orderId: order.id }
        });
        if (!orderItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order item not found.");
        }

        const oldQuantity = parseFloat(orderItem.quantity || 0);
        const oldSellUnit = orderItem.sellUnit;
        const newQuantity = parseFloat(quantity || 0);
        const newSellUnit = sellUnit || oldSellUnit;

        let variant = null;
        if (variantId && variantId !== orderItem.variantId) {
            variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'volumeRef' },
                    { model: Volume, as: 'baseUnitRef' },
                    { model: Volume, as: 'innerUnitRef' }
                ]
            });
            if (!variant) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found.");
            }
        } else {
            variant = await ProductVariant.findByPk(orderItem.variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'volumeRef' },
                    { model: Volume, as: 'baseUnitRef' },
                    { model: Volume, as: 'innerUnitRef' }
                ]
            });
        }

        const oldBUPP = parseFloat(orderItem.variantInfo?.baseUnitsPerPack || 1);
        const newBUPP = variant ? parseFloat(variant.baseUnitsPerPack || 1) : oldBUPP;

        // Calculate old and new base units
        const oldBaseUnits = oldSellUnit === 'Inner' ? oldQuantity : oldQuantity * oldBUPP;
        const newBaseUnits = newSellUnit === 'Inner' ? newQuantity : newQuantity * newBUPP;
        const baseUnitsDiff = newBaseUnits - oldBaseUnits;

        orderItem.quantity = newQuantity;
        orderItem.price = parseFloat(price || 0);
        orderItem.sellUnit = newSellUnit;

        if (variant) {
            if (variant.id !== orderItem.variantId) {
                orderItem.variantId = variant.id;
                orderItem.productId = variant.productId;
            }
            orderItem.variantInfo = {
                productName: variant.product?.name || '',
                volume: variant.volume,
                extra: variant.extra || '',
                extraName: variant.extra || '',
                image: variant.image || variant.product?.thumbnail || '',
                innerUnitLabel: variant.innerUnitRef?.name
                    ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                    : variant.innerUnitLabel,
                baseUnitLabel: variant.baseUnitRef?.name
                    ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                    : variant.baseUnitLabel,
                sellingVolume: variant.sellingVolume
            };
        }

        await orderItem.save();

        // Adjust stock if base units changed
        if (baseUnitsDiff !== 0) {
            const stock = await InventoryStock.findOne({
                where: { productId: orderItem.productId },
                order: [['createdAt', 'DESC']]
            });
            if (stock) {
                await stock.update({ totalBaseUnits: Math.max(0, stock.totalBaseUnits - baseUnitsDiff) });
            }
        }

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);

        if (paidAmount >= newTotalAmount) {
            order.paymentStatus = 'Paid';
        } else if (paidAmount > 0) {
            order.paymentStatus = 'Partial';
        } else {
            order.paymentStatus = 'Pending';
        }

        await order.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order item updated successfully.", order);
    } catch (error) {
        logger.error(`[Admin Update Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Add a new item to an existing order
 * @route   POST /api/admin/orders/:id/items
 * @access  Private (Admin)
 */
export const addOrderItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { variantId, quantity, price, sellUnit } = req.body;

        if (!variantId || !quantity || !price) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "variantId, quantity and price are required.");
        }

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const variant = await ProductVariant.findByPk(variantId, {
            include: [
                { model: Product, as: 'product' },
                { model: Volume, as: 'volumeRef' },
                { model: Volume, as: 'baseUnitRef' },
                { model: Volume, as: 'innerUnitRef' }
            ]
        });
        if (!variant) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found.");
        }

        const qty = parseFloat(quantity);
        const unitSell = sellUnit || 'Base';
        const bUPP = parseFloat(variant.baseUnitsPerPack || 1);

        // Build variantInfo snapshot for the order item
        const variantInfo = {
            productName: variant.product?.name || '',
            volume: variant.volume,
            extra: variant.extra || '',
            extraName: variant.extra || '',
            image: variant.image || variant.product?.thumbnail || '',
            innerUnitLabel: variant.innerUnitRef?.name
                ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                : variant.innerUnitLabel,
            baseUnitLabel: variant.baseUnitRef?.name
                ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                : variant.baseUnitLabel,
            sellingVolume: variant.sellingVolume
        };

        // Create the new order item
        const newItem = await OrderItem.create({
            orderId: order.id,
            productId: variant.productId,
            variantId: variant.id,
            quantity: qty,
            price: parseFloat(price),
            sellUnit: unitSell,
            variantInfo
        });

        // Deduct from stock
        const baseUnitsToDeduct = unitSell === 'Inner' ? qty : qty * bUPP;
        const stock = await InventoryStock.findOne({
            where: { productId: variant.productId },
            order: [['createdAt', 'DESC']]
        });
        if (stock) {
            await stock.update({ totalBaseUnits: Math.max(0, stock.totalBaseUnits - baseUnitsToDeduct) });
        }

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);
        if (paidAmount >= newTotalAmount) order.paymentStatus = 'Paid';
        else if (paidAmount > 0) order.paymentStatus = 'Partial';
        else order.paymentStatus = 'Pending';

        await order.save();

        logger.info(`[Admin Add Order Item]: Added variant ${variantId} to order ${id}`);
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Item added to order successfully.", { item: newItem, order });
    } catch (error) {
        logger.error(`[Admin Add Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delete an item from an existing order (qty set to 0)
 * @route   DELETE /api/admin/orders/:id/items/:itemId
 * @access  Private (Admin)
 */
export const deleteOrderItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const orderItem = await OrderItem.findOne({ where: { id: itemId, orderId: order.id } });
        if (!orderItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order item not found.");
        }

        const qty = parseFloat(orderItem.quantity || 0);
        const unitSell = orderItem.sellUnit || 'Base';
        const variant = await ProductVariant.findByPk(orderItem.variantId);
        const bUPP = parseFloat(variant?.baseUnitsPerPack || orderItem.variantInfo?.baseUnitsPerPack || 1);

        // Restore stock
        const baseUnitsToRestore = unitSell === 'Inner' ? qty : qty * bUPP;
        const stock = await InventoryStock.findOne({
            where: { productId: orderItem.productId },
            order: [['createdAt', 'DESC']]
        });
        if (stock) {
            await stock.update({ totalBaseUnits: stock.totalBaseUnits + baseUnitsToRestore });
        }

        await orderItem.destroy();

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);
        if (paidAmount >= newTotalAmount) order.paymentStatus = 'Paid';
        else if (paidAmount > 0) order.paymentStatus = 'Partial';
        else order.paymentStatus = 'Pending';

        await order.save();

        logger.info(`[Admin Delete Order Item]: Removed item ${itemId} from order ${id}`);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from order successfully.", order);
    } catch (error) {
        logger.error(`[Admin Delete Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

