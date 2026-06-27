import { Op } from 'sequelize';
import { OrderPayment, Order, User, DeliveryBoy, BankSetting, BusinessProfile } from '../../models/index.js';
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
        const { status, search, date, fromDate, toDate, deliveryBoyId } = req.query;
        const where = {};

        if (deliveryBoyId) {
            where.deliveryBoyId = deliveryBoyId;
        }

        // Support tabs: CASH, ONLINE, CREDIT, Razorpay, Bank Account, Submitted, Pending
        if (status) {
            if (status === 'CASH' || status === 'CREDIT') {
                where.paymentMethod = status;
            } else if (status === 'ONLINE') {
                where.paymentMethod = 'ONLINE';
            } else if (status === 'Razorpay') {
                where.paymentMethod = 'ONLINE';
                where.onlineType = 'Razorpay';
            } else if (status === 'Bank Account') {
                where.paymentMethod = 'ONLINE';
                where.onlineType = 'Bank Account';
            } else if (status === 'Submitted') {
                where.isSubmitted = true;
            } else if (status === 'Pending') {
                where.isSubmitted = false;
            }
        }

        if (fromDate || toDate) {
            const dateFilter = {};
            if (fromDate) {
                const start = new Date(fromDate);
                start.setHours(0, 0, 0, 0);
                dateFilter[Op.gte] = start;
            }
            if (toDate) {
                const end = new Date(toDate);
                end.setHours(23, 59, 59, 999);
                dateFilter[Op.lte] = end;
            }
            where.createdAt = dateFilter;
        } else if (date) {
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
                            attributes: ['id', 'fullname', 'number', 'city'],
                            include: [
                                {
                                    model: BusinessProfile,
                                    as: 'businessProfile',
                                    attributes: ['id', 'shopName', 'shopAddress', 'gstNumber']
                                }
                            ]
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone', 'vehicleNumber']
                },
                {
                    model: BankSetting,
                    as: 'bankAccount',
                    attributes: ['id', 'bankName', 'accountName', 'accountNumber', 'branchName'],
                    required: false
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        const baseCountWhere = {};
        if (deliveryBoyId) {
            baseCountWhere.deliveryBoyId = deliveryBoyId;
        }

        // ── Calculate Status Counts for Tab Badges ──
        const [cashCount, onlineCount, creditCount, submittedCount, pendingSubmitCount, razorpayCount, bankAccountCount] = await Promise.all([
            OrderPayment.count({ where: { ...baseCountWhere, paymentMethod: 'CASH' } }),
            OrderPayment.count({ where: { ...baseCountWhere, paymentMethod: 'ONLINE' } }),
            OrderPayment.count({ where: { ...baseCountWhere, paymentMethod: 'CREDIT' } }),
            OrderPayment.count({ where: { ...baseCountWhere, isSubmitted: true } }),
            OrderPayment.count({ where: { ...baseCountWhere, isSubmitted: false } }),
            OrderPayment.count({ where: { ...baseCountWhere, paymentMethod: 'ONLINE', onlineType: 'Razorpay' } }),
            OrderPayment.count({ where: { ...baseCountWhere, paymentMethod: 'ONLINE', onlineType: 'Bank Account' } })
        ]);

        const responseData = formatPaginatedResponse(result, page, limit);

        responseData.statusCounts = {
            '': responseData.totalRecords, // All payments count
            All: responseData.totalRecords, // Support 'All' tab key
            CASH: cashCount,
            ONLINE: onlineCount,
            CREDIT: creditCount,
            Submitted: submittedCount,
            Pending: pendingSubmitCount,
            Razorpay: razorpayCount,
            'Bank Account': bankAccountCount
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
    const t = await OrderPayment.sequelize.transaction();
    try {
        const { id } = req.params;
        const { isSubmitted, bankSettingId, screenshot, onlineType, transactionId, notes } = req.body;

        const payment = await OrderPayment.findByPk(id, { transaction: t });

        if (!payment) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Payment transaction not found.");
        }

        const wasSubmitted = payment.isSubmitted;
        const willBeSubmitted = isSubmitted !== undefined ? isSubmitted : true;

        payment.isSubmitted = willBeSubmitted;
        payment.submittedAt = willBeSubmitted ? new Date() : null;

        if (bankSettingId !== undefined) payment.bankSettingId = bankSettingId || null;
        if (screenshot !== undefined) payment.screenshot = screenshot || null;
        if (onlineType !== undefined) payment.onlineType = onlineType || null;
        if (transactionId !== undefined) payment.transactionId = transactionId || null;
        if (notes !== undefined) payment.notes = notes || null;

        await payment.save({ transaction: t });

        // If the payment is being verified now (transitioning from unverified to verified)
        if (willBeSubmitted && !wasSubmitted) {
            const order = await Order.findByPk(payment.orderId, { transaction: t });
            if (order) {
                const paymentAmt = parseFloat(payment.amount);
                
                // Deduct from order dueAmount and add to paidAmount
                const currentDue = parseFloat(order.dueAmount);
                const currentPaid = parseFloat(order.paidAmount);
                
                const newDue = Math.max(0, currentDue - paymentAmt);
                const newPaid = currentPaid + Math.min(currentDue, paymentAmt);
                
                const paymentStatus = newDue <= 1e-7 ? 'Paid' : 'Pending';
                
                // If the order status is 'Payment Verify', update it
                let orderStatus = order.orderStatus;
                if (orderStatus === 'Payment Verify') {
                    orderStatus = newDue <= 1e-7 ? 'Delivered' : 'Payment Collect';
                }

                await order.update({
                    dueAmount: newDue,
                    paidAmount: newPaid,
                    paymentStatus,
                    orderStatus
                }, { transaction: t });

                // Restore user credit if any credit was used for this order
                if (order.userId) {
                    const user = await User.findByPk(order.userId, { transaction: t });
                    if (user) {
                        // Dynamically import restoreUserCreditFromPayment to avoid circular dependencies
                        const { restoreUserCreditFromPayment } = await import('../delivery/order.controller.js');
                        await restoreUserCreditFromPayment(order.id, paymentAmt, user, t);
                        await user.save({ transaction: t });
                    }
                }
            }
        }

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment submission status updated successfully.", payment);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Admin Update Payment Submission Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
