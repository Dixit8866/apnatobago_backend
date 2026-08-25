import { Op } from 'sequelize';
import { OrderPayment, Order, User, DeliveryBoy, BankSetting, BusinessProfile, PartyBalanceLog, SalesReturn } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

/**
 * @desc    Get all payments for admin
 * @route   GET /api/admin/payments
 * @access  Private (Admin)
 */
export const getAllPayments = async (req, res) => {
    try {
        const { status, search, date, fromDate, toDate, deliveryBoyId, godownId } = req.query;
        const where = {};

        if (deliveryBoyId) {
            where.deliveryBoyId = deliveryBoyId;
        }

        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            where['$order.godownId$'] = godownId;
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
            const escapedSearch = OrderPayment.sequelize.escape(`%${search}%`);
            where[Op.and] = [
                OrderPayment.sequelize.literal(`(
                    "OrderPayment"."transactionId" ILIKE ${escapedSearch}
                    OR "order"."orderId" ILIKE ${escapedSearch}
                    OR "order->user"."fullname" ILIKE ${escapedSearch}
                    OR "order"."customerName" ILIKE ${escapedSearch}
                    OR "deliveryBoy"."name" ILIKE ${escapedSearch}
                )`)
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
                    attributes: ['id', 'orderId', 'totalAmount', 'paymentMethod', 'paymentStatus', 'customerName', 'customerNumber', 'couponPoints', 'couponDiscount', 'discountType', 'discount'],
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

        if (Array.isArray(responseData.data)) {
            responseData.data = responseData.data.map(payment => {
                const p = payment.toJSON ? payment.toJSON() : payment;
                if (p.order) {
                    const totalAmt = parseFloat(p.order.totalAmount || 0);
                    const couponDisc = parseFloat(p.order.couponDiscount || 0);
                    p.order.payableAmount = Math.max(0, totalAmt - couponDisc).toFixed(2);
                    p.order.couponPoints = Number(p.order.couponPoints || 0);
                    p.order.couponDiscount = couponDisc.toFixed(2);
                    p.order.discountType = p.order.discountType || (couponDisc > 0 ? 'Coupon Discount' : null);
                }
                return p;
            });
        }

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
        logActivity(req, {
            module: 'Payment',
            action: 'UPDATE',
            description: `Payment ${payment.id} status updated to ${isSubmitted ? 'Verified' : 'Unverified'} (Amount: ₹${payment.amount})`,
            metadata: { paymentId: payment.id, orderId: payment.orderId, amount: payment.amount, isSubmitted }
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment submission status updated successfully.", payment);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Admin Update Payment Submission Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get Daily Reconciliation Report (Bank Breakdown, Pending Dues List, Difference Explanation)
 * @route   GET /api/admin/payments/daily-reconciliation-report
 * @access  Private (Admin)
 */
export const getDailyReconciliationReport = async (req, res) => {
    try {
        const { date, startDate, endDate, deliveryBoyId } = req.query;

        // Build date range
        let dateFilter = {};
        if (startDate || endDate) {
            if (startDate) {
                const start = new Date(startDate);
                start.setHours(0, 0, 0, 0);
                dateFilter[Op.gte] = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                dateFilter[Op.lte] = end;
            }
        } else {
            const targetDate = date ? new Date(date) : new Date();
            const startOfDay = new Date(targetDate);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(targetDate);
            endOfDay.setHours(23, 59, 59, 999);
            dateFilter = { [Op.between]: [startOfDay, endOfDay] };
        }

        const paymentWhere = { createdAt: dateFilter };
        if (deliveryBoyId) paymentWhere.deliveryBoyId = deliveryBoyId;

        // 1. Fetch Online Payments with Bank Setting Breakdown
        const onlinePayments = await OrderPayment.findAll({
            where: { ...paymentWhere, paymentMethod: 'ONLINE' },
            include: [
                {
                    model: BankSetting,
                    as: 'bankAccount',
                    attributes: ['id', 'bankName', 'accountName', 'accountNumber', 'branchName']
                }
            ]
        });

        const bankBreakdownMap = {};
        let totalOnlineSum = 0;

        onlinePayments.forEach(p => {
            const amt = parseFloat(p.amount || 0);
            totalOnlineSum += amt;
            const bankId = p.bankSettingId || 'UNASSIGNED';
            const bankName = p.bankAccount ? `${p.bankAccount.bankName} (${p.bankAccount.accountNumber || ''})` : (p.onlineType || 'General Online / UPI');

            if (!bankBreakdownMap[bankId]) {
                bankBreakdownMap[bankId] = {
                    bankSettingId: p.bankSettingId,
                    bankName,
                    accountName: p.bankAccount?.accountName || '-',
                    accountNumber: p.bankAccount?.accountNumber || '-',
                    branchName: p.bankAccount?.branchName || '-',
                    onlineType: p.onlineType || 'Online',
                    totalAmount: 0,
                    count: 0
                };
            }
            bankBreakdownMap[bankId].totalAmount += amt;
            bankBreakdownMap[bankId].count += 1;
        });

        const bankBreakdownList = Object.values(bankBreakdownMap);

        // 2. Fetch Pending Due Orders for the period
        const orderWhere = { createdAt: dateFilter, dueAmount: { [Op.gt]: 0 } };
        const pendingDueOrders = await Order.findAll({
            where: orderWhere,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'walletBalance'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['shopName', 'shopAddress', 'postcode']
                        }
                    ]
                }
            ],
            order: [['dueAmount', 'DESC']]
        });

        let totalPendingDueSum = 0;
        pendingDueOrders.forEach(o => {
            totalPendingDueSum += parseFloat(o.dueAmount || 0);
        });

        // 3. Calculate Daily Reconciliation Breakdown
        const cashPayments = await OrderPayment.findAll({
            where: { ...paymentWhere, paymentMethod: 'CASH' }
        });
        let totalCashSum = 0;
        cashPayments.forEach(p => { totalCashSum += parseFloat(p.amount || 0); });

        const totalReceived = totalCashSum + totalOnlineSum;

        // Fetch Today's Delivered / Completed Orders Total
        const deliveredOrders = await Order.findAll({
            where: {
                createdAt: dateFilter,
                orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'] }
            }
        });

        let todayDeliveredOrdersTotal = 0;
        deliveredOrders.forEach(o => { todayDeliveredOrdersTotal += parseFloat(o.totalAmount || 0); });

        // Sales returns created today
        const salesReturnsToday = await SalesReturn.findAll({
            where: { createdAt: dateFilter }
        });
        let salesReturnsTotal = 0;
        salesReturnsToday.forEach(sr => { salesReturnsTotal += parseFloat(sr.returnAmount || 0); });

        // Jama Wallet logs created today
        const jamaLogsToday = await PartyBalanceLog.findAll({
            where: { createdAt: dateFilter, type: 'JAMA' }
        });
        let walletJamaTotal = 0;
        jamaLogsToday.forEach(log => { walletJamaTotal += parseFloat(log.amount || 0); });

        const netDifference = totalReceived - todayDeliveredOrdersTotal;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Daily reconciliation report fetched.", {
            totalCashCollect: totalCashSum,
            totalOnlineCollect: totalOnlineSum,
            totalReceived,
            totalPendingDue: totalPendingDueSum,
            todayDeliveredOrdersTotal,
            netDifference,
            bankBreakdownList,
            pendingDueOrders: pendingDueOrders.map(o => ({
                id: o.id,
                orderId: o.orderId,
                totalAmount: o.totalAmount,
                dueAmount: o.dueAmount,
                paidAmount: o.paidAmount,
                createdAt: o.createdAt,
                customerName: o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName,
                customerPhone: o.user?.number || o.customerNumber,
                partyWalletBalance: o.user?.walletBalance || 0
            })),
            reconciliationExplanation: {
                todayDeliveredOrdersTotal,
                totalReceived,
                netDifference,
                salesReturnsTotal,
                walletJamaTotal,
                pendingDuesTotal: totalPendingDueSum
            }
        });

    } catch (error) {
        logger.error(`[Get Daily Reconciliation Report Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
