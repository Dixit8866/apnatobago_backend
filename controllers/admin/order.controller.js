import { Op } from 'sequelize';
import { Order, OrderItem, Product, ProductVariant, User, Volume, OrderAssignment, DeliveryBoy, BusinessProfile, OrderPayment } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { generateOrderInvoice, generateDeliveryLabel, generateDeliveryLabelHTML } from '../../utils/invoiceGenerator.js';
// ... (rest of imports)

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
        const { status, date, search } = req.query;
        const where = { saleType: 'Online' }; // Strictly filter online user orders to exclude direct admin/POS sales

        if (search) {
            // Global search bypasses tab status and date limits so users can find orders instantly
            where[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerNumber: { [Op.iLike]: `%${search}%` } },
                { '$user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$user.number$': { [Op.iLike]: `%${search}%` } },
                { '$user.businessProfile.shopName$': { [Op.iLike]: `%${search}%` } }
            ];
        } else {
            // Apply status and date filters only when there is no active search
            if (status && status !== 'All') {
                where.orderStatus = status;
            }

            if (date) {
                // Filter by specific date
                const startOfDay = new Date(date);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(date);
                endOfDay.setHours(23, 59, 59, 999);
                where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
            }
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

        // ── Calculate Global Status Counts for Tab Badges ────────────────────────
        // These are calculated independently of the current filters (except date for 'Today')
        const todayStr = new Date().toISOString().split('T')[0];
        const startOfToday = new Date(todayStr);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(todayStr);
        endOfToday.setHours(23, 59, 59, 999);

        const [pendingCount, packagingCount, packedCount, shippingCount, deliveredCount, paymentCollectCount, cancelledCount, todayCount] = await Promise.all([
            Order.count({ where: { orderStatus: 'Pending', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Packaging', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Packed', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Shipping', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Delivered', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Payment Collect', saleType: 'Online' } }),
            Order.count({ where: { orderStatus: 'Cancelled', saleType: 'Online' } }),
            Order.count({ where: { createdAt: { [Op.between]: [startOfToday, endOfToday] }, saleType: 'Online' } })
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
            Cancelled: cancelledCount
        };

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
            const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Cancelled'];
            if (!validStatuses.includes(orderStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
            }
            order.orderStatus = orderStatus;
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

        const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Cancelled'];
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

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", order);
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
