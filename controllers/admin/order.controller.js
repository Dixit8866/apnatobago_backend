import { Op } from 'sequelize';
import { Order, OrderItem, Product, ProductVariant, User, Volume, OrderAssignment, DeliveryBoy, BusinessProfile, OrderPayment } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { generateOrderInvoice, generateDeliveryLabel, generateDeliveryLabelHTML } from '../../utils/invoiceGenerator.js';
// ... (rest of imports)

const adjustOrderPayments = (order) => {
    if (!order) return order;
    
    const rowData = order.toJSON ? order.toJSON() : order;
    if (!rowData.payments || rowData.payments.length === 0) return rowData;

    let payments = rowData.payments.map(p => p.toJSON ? p.toJSON() : { ...p });

    // If the order is in "Payment Collect" status, ONLY show payments currently pending verification (isSubmitted = false)
    if (rowData.orderStatus === 'Payment Collect') {
        payments = payments.filter(p => p.isSubmitted === false);
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
        const { status, date, search, deliveryBoyId, startDate, endDate } = req.query;
        const where = { saleType: 'Online' }; // Strictly filter online user orders to exclude direct admin/POS sales

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

        // Apply status filter
        if (status && status !== 'All') {
            if (status === 'Delivered') {
                where.orderStatus = { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] };
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
            where.createdAt = { [Op.between]: [startOfDate, endOfDate] };
        } else if (startDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(startDate);
            endOfDate.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [startOfDate, endOfDate] };
        } else if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
        }

        // Apply delivery boy filter
        if (deliveryBoyId) {
            where['$assignment.deliveryBoyId$'] = deliveryBoyId;
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
                            attributes: ['id', 'shopName']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
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
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name', 'phone'] }]
                },
                {
                    model: OrderPayment,
                    as: 'payments',
                    attributes: ['id', 'amount', 'paymentMethod', 'isSubmitted', 'submittedAt']
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        // ── Calculate Dynamic Status Counts for Tab Badges ────────────────────────
        const countWhere = { saleType: 'Online' };
        const countInclude = [];

        if (deliveryBoyId) {
            countWhere['$assignment.deliveryBoyId$'] = deliveryBoyId;
            countInclude.push({
                model: OrderAssignment,
                as: 'assignment'
            });
        }

        if (startDate && endDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(endDate);
            endOfDate.setHours(23, 59, 59, 999);
            countWhere.createdAt = { [Op.between]: [startOfDate, endOfDate] };
        } else if (startDate) {
            const startOfDate = new Date(startDate);
            startOfDate.setHours(0, 0, 0, 0);
            const endOfDate = new Date(startDate);
            endOfDate.setHours(23, 59, 59, 999);
            countWhere.createdAt = { [Op.between]: [startOfDate, endOfDate] };
        } else if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            countWhere.createdAt = { [Op.between]: [startOfDay, endOfDay] };
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const startOfToday = new Date(todayStr);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(todayStr);
        endOfToday.setHours(23, 59, 59, 999);

        const [pendingCount, packagingCount, packedCount, shippingCount, deliveredCount, paymentCollectCount, paymentVerifyCount, cancelledCount, todayCount] = await Promise.all([
            Order.count({ where: { ...countWhere, orderStatus: 'Pending' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Packaging' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Packed' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Shipping' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] } }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Payment Collect' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Payment Verify' }, include: countInclude }),
            Order.count({ where: { ...countWhere, orderStatus: 'Cancelled' }, include: countInclude }),
            Order.count({ where: { ...countWhere, createdAt: { [Op.between]: [startOfToday, endOfToday] } }, include: countInclude })
        ]);

        const responseData = formatPaginatedResponse(result, page, limit);
        
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
            Cancelled: cancelledCount
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
        const { orderStatus, paymentStatus, paidAmount: newPaidAmount } = req.body;

        const order = await Order.findByPk(id);

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        if (orderStatus) {
            const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled'];
            if (!validStatuses.includes(orderStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
            }
            order.orderStatus = orderStatus;

            // If moving to verified status, auto-submit any pending payments and recalculate paid/due amount
            if (orderStatus === 'Payment Verify' || orderStatus === 'Delivered') {
                await OrderPayment.update(
                    { isSubmitted: true, submittedAt: new Date() },
                    { where: { orderId: order.id, isSubmitted: false } }
                );

                // Recalculate actual paidAmount and dueAmount from OrderPayment records
                const paymentsList = await OrderPayment.findAll({ where: { orderId: order.id } });
                const totalCashOnlinePaid = paymentsList
                    .filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE')
                    .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

                const total = parseFloat(order.totalAmount || 0);
                order.paidAmount = totalCashOnlinePaid;
                order.dueAmount = Math.max(0, total - totalCashOnlinePaid);

                if (order.paidAmount >= total) {
                    order.paymentStatus = 'Paid';
                } else if (order.paidAmount > 0) {
                    order.paymentStatus = 'Partial';
                } else {
                    order.paymentStatus = 'Pending';
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

        await order.save();

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

        const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled'];
        if (!validStatuses.includes(orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
        }

        // Update all matching orders
        await Order.update(
            { orderStatus },
            { where: { id: orderIds } }
        );

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
        const { orderIds } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const orders = await Order.findAll({ where: { id: orderIds } });

        for (const order of orders) {
            order.orderStatus = 'Payment Verify';
            order.paymentCollectStatus = 'Verified';

            // Auto-submit associated unsubmitted payments first
            await OrderPayment.update(
                { isSubmitted: true, submittedAt: new Date() },
                { where: { orderId: order.id, isSubmitted: false } }
            );

            // Recalculate actual paidAmount and dueAmount from OrderPayment records
            const paymentsList = await OrderPayment.findAll({ where: { orderId: order.id } });
            const totalCashOnlinePaid = paymentsList
                .filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE')
                .reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

            const total = parseFloat(order.totalAmount || 0);
            order.paidAmount = totalCashOnlinePaid;
            order.dueAmount = Math.max(0, total - totalCashOnlinePaid);

            if (order.paidAmount >= total) {
                order.paymentStatus = 'Paid';
            } else if (order.paidAmount > 0) {
                order.paymentStatus = 'Partial';
            } else {
                order.paymentStatus = 'Pending';
            }

            await order.save();
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
        const order = await Order.findByPk(id, {
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'dialcode']
                },
                {
                    model: OrderItem,
                    as: 'items',
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
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
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
                        { model: Product, as: 'product' },
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
