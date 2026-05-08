import { Op } from 'sequelize';
import { OrderPayment, Order, User, DeliveryBoy } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * @desc    Get all payments for admin
 * @route   GET /api/admin/payments
 * @access  Private (Admin)
 */
export const getAllPayments = async (req, res) => {
    try {
        const { status, search, date } = req.query;
        const where = {};

        // Support tabs: CASH, ONLINE, CREDIT, Submitted, Pending
        if (status) {
            if (status === 'CASH' || status === 'ONLINE' || status === 'CREDIT') {
                where.paymentMethod = status;
            } else if (status === 'Submitted') {
                where.isSubmitted = true;
            } else if (status === 'Pending') {
                where.isSubmitted = false;
            }
        }

        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
        }

        if (search) {
            where[Op.or] = [
                { transactionId: { [Op.iLike]: `%${search}%` } },
                { '$order.orderId$': { [Op.iLike]: `%${search}%` } },
                { '$order.user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$order.customerName$': { [Op.iLike]: `%${search}%` } },
                { '$deliveryBoy.name$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await OrderPayment.findAndCountAll({
            where,
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'totalAmount', 'paymentMethod', 'paymentStatus', 'customerName', 'customerNumber'],
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'fullname', 'number', 'city']
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone', 'vehicleNumber']
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        // ── Calculate Status Counts for Tab Badges ──
        const [cashCount, onlineCount, creditCount, submittedCount, pendingSubmitCount] = await Promise.all([
            OrderPayment.count({ where: { paymentMethod: 'CASH' } }),
            OrderPayment.count({ where: { paymentMethod: 'ONLINE' } }),
            OrderPayment.count({ where: { paymentMethod: 'CREDIT' } }),
            OrderPayment.count({ where: { isSubmitted: true } }),
            OrderPayment.count({ where: { isSubmitted: false } })
        ]);

        const responseData = formatPaginatedResponse(result, page, limit);

        responseData.statusCounts = {
            '': responseData.totalRecords, // All payments count
            CASH: cashCount,
            ONLINE: onlineCount,
            CREDIT: creditCount,
            Submitted: submittedCount,
            Pending: pendingSubmitCount
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payments fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Admin Get Payments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Approve/submit/reconcile payment
 * @route   PUT /api/admin/payments/:id/submit
 * @access  Private (Admin)
 */
export const updatePaymentSubmission = async (req, res) => {
    try {
        const { id } = req.params;
        const { isSubmitted } = req.body;

        const payment = await OrderPayment.findByPk(id);

        if (!payment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Payment transaction not found.");
        }

        payment.isSubmitted = isSubmitted !== undefined ? isSubmitted : true;
        payment.submittedAt = payment.isSubmitted ? new Date() : null;

        await payment.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment submission status updated successfully.", payment);
    } catch (error) {
        logger.error(`[Admin Update Payment Submission Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
