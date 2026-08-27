import { Op } from 'sequelize';
import { OrderPayment, Order, User, DeliveryBoy, BankSetting, BusinessProfile, PartyBalanceLog, SalesReturn, OrderAssignment } from '../../models/index.js';
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
        let startOfDay, endOfDay;
        if (startDate || endDate) {
            if (startDate) {
                startOfDay = new Date(startDate);
                startOfDay.setHours(0, 0, 0, 0);
                dateFilter[Op.gte] = startOfDay;
            }
            if (endDate) {
                endOfDay = new Date(endDate);
                endOfDay.setHours(23, 59, 59, 999);
                dateFilter[Op.lte] = endOfDay;
            }
        } else {
            const targetDate = date ? new Date(date) : new Date();
            startOfDay = new Date(targetDate);
            startOfDay.setHours(0, 0, 0, 0);
            endOfDay = new Date(targetDate);
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
                },
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'createdAt', 'deliveredAt', 'updatedAt', 'totalAmount', 'dueAmount', 'customerName', 'customerNumber'],
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'fullname', 'number', 'city'],
                            include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress'] }]
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone']
                }
            ]
        });

        const bankBreakdownMap = {};
        let totalOnlineSum = 0;

        onlinePayments.forEach(p => {
            const amt = parseFloat(p.amount || 0);
            totalOnlineSum += amt;
            const bankId = p.bankSettingId || 'UNASSIGNED';
            const bankName = p.bankAccount ? p.bankAccount.bankName : (p.onlineType || 'General Online / UPI');

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

        // 2. Fetch Cash Payments with Order & Delivery Boy Details
        const cashPayments = await OrderPayment.findAll({
            where: { ...paymentWhere, paymentMethod: 'CASH' },
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'createdAt', 'deliveredAt', 'updatedAt', 'totalAmount', 'dueAmount', 'customerName', 'customerNumber'],
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'fullname', 'number', 'city'],
                            include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress'] }]
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone']
                }
            ]
        });
        let totalCashSum = 0;
        cashPayments.forEach(p => {
            let amt = parseFloat(p.amount || 0);
            if (p.order && p.order.totalAmount !== undefined && p.order.totalAmount !== null) {
                const orderTot = parseFloat(p.order.totalAmount || 0);
                if (amt > orderTot) amt = orderTot;
            }
            totalCashSum += amt;
        });

        onlinePayments.forEach(p => {
            let amt = parseFloat(p.amount || 0);
            if (p.order && p.order.totalAmount !== undefined && p.order.totalAmount !== null) {
                const orderTot = parseFloat(p.order.totalAmount || 0);
                if (amt > orderTot) amt = orderTot;
            }
            totalOnlineSum += amt;
        });

        const totalReceived = totalCashSum + totalOnlineSum;

        // Build quick lookup map for DeliveryBoy from payment records
        const paymentDeliveryBoyMap = {};
        [...cashPayments, ...onlinePayments].forEach(p => {
            const oId = p.orderId || p.order?.id;
            if (oId && p.deliveryBoy) {
                paymentDeliveryBoyMap[oId] = p.deliveryBoy;
            }
        });

        // 3. Fetch Today's Delivered / Completed Orders
        const deliveredOrders = await Order.findAll({
            where: {
                orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'] },
                [Op.or]: [
                    { deliveredAt: dateFilter },
                    { deliveredAt: null, updatedAt: dateFilter },
                    { deliveredAt: null, updatedAt: null, createdAt: dateFilter }
                ]
            },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'walletBalance'],
                    include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress', 'postcode'] }]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    required: false,
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', required: false, attributes: ['id', 'name', 'phone'] }]
                },
                {
                    model: OrderPayment,
                    as: 'payments',
                    required: false,
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', required: false, attributes: ['id', 'name', 'phone'] }]
                }
            ],
            order: [['updatedAt', 'DESC'], ['createdAt', 'DESC']]
        });

        let todayDeliveredOrdersTotal = 0;
        const todayDeliveredOrdersList = deliveredOrders.map(o => {
            const tot = parseFloat(o.totalAmount || 0);
            todayDeliveredOrdersTotal += tot;

            let pAmt = parseFloat(o.paidAmount || 0);
            if (pAmt > tot) {
                pAmt = tot;
            }

            // Resolve delivery boy from assignment, order payment association, or payment map
            const paymentBoy = o.payments?.find(p => p.deliveryBoy?.name)?.deliveryBoy;
            const dbBoy = o.assignment?.deliveryBoy || paymentBoy || paymentDeliveryBoyMap[o.id];

            return {
                id: o.id,
                orderId: o.orderId,
                totalAmount: tot,
                dueAmount: parseFloat(o.dueAmount || 0),
                paidAmount: pAmt,
                paymentMethod: o.paymentMethod,
                paymentStatus: o.paymentStatus,
                orderStatus: o.orderStatus,
                createdAt: o.createdAt,
                customerName: o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName || 'Guest',
                customerPhone: o.user?.number || o.customerNumber || '-',
                shopAddress: o.user?.businessProfile?.shopAddress || '-',
                deliveryBoyName: dbBoy?.name || '-',
                deliveryBoyPhone: dbBoy?.phone || '-'
            };
        });

        // 4. Today's Pending Due Orders (Delivered today with dueAmount > 0)
        const todayPendingDueOrdersList = todayDeliveredOrdersList.filter(o => o.dueAmount > 0);
        let totalTodayPendingDueSum = todayPendingDueOrdersList.reduce((sum, o) => sum + o.dueAmount, 0);

        // All Pending Due Orders across all time
        const allPendingDueOrders = await Order.findAll({
            where: { dueAmount: { [Op.gt]: 0 } },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'walletBalance'],
                    include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress', 'postcode'] }]
                }
            ],
            order: [['dueAmount', 'DESC']]
        });
        const pendingDueOrdersFormatted = allPendingDueOrders.map(o => ({
            id: o.id,
            orderId: o.orderId,
            totalAmount: parseFloat(o.totalAmount || 0),
            dueAmount: parseFloat(o.dueAmount || 0),
            paidAmount: parseFloat(o.paidAmount || 0),
            createdAt: o.createdAt,
            customerName: o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName,
            customerPhone: o.user?.number || o.customerNumber,
            partyWalletBalance: o.user?.walletBalance || 0
        }));

        // 5. Past Pending Dues Cleared Today (Payments collected today for orders DELIVERED BEFORE today)
        const allTodayPayments = [...cashPayments, ...onlinePayments];
        const todayDeliveredOrderIds = new Set(deliveredOrders.map(o => o.id));
        const pastDuesClearedList = [];
        let pastDuesClearedTotal = 0;

        const effectiveStartOfDay = startOfDay ? startOfDay.getTime() : 0;

        allTodayPayments.forEach(p => {
            if (p.order && !todayDeliveredOrderIds.has(p.order.id)) {
                // Determine when the order was delivered / fulfilled
                const deliveryTime = p.order.deliveredAt 
                    ? new Date(p.order.deliveredAt).getTime() 
                    : (p.order.updatedAt ? new Date(p.order.updatedAt).getTime() : new Date(p.order.createdAt).getTime());

                // If the order was delivered BEFORE today, payment collected today is for Past Dues!
                if (deliveryTime < effectiveStartOfDay) {
                    const pAmt = parseFloat(p.amount || 0);
                    pastDuesClearedTotal += pAmt;
                    pastDuesClearedList.push({
                        paymentId: p.id,
                        orderId: p.order.orderId,
                        orderDbId: p.order.id,
                        orderDate: p.order.createdAt,
                        deliveredDate: p.order.deliveredAt || p.order.createdAt,
                        paymentMethod: p.paymentMethod,
                        amount: pAmt,
                        paymentDate: p.createdAt,
                        customerName: p.order.user?.businessProfile?.shopName || p.order.user?.fullname || p.order.customerName || 'Guest',
                        customerPhone: p.order.user?.number || p.order.customerNumber || '-',
                        deliveryBoyName: p.deliveryBoy?.name || '-'
                    });
                }
            }
        });

        // 6. Sales returns created today
        const salesReturnsToday = await SalesReturn.findAll({
            where: { createdAt: dateFilter },
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'customerName', 'customerNumber'],
                    include: [{ model: User, as: 'user', attributes: ['id', 'fullname', 'number'], include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName'] }] }]
                }
            ]
        });
        let salesReturnsTotal = 0;
        const salesReturnsList = salesReturnsToday.map(sr => {
            const rAmt = parseFloat(sr.returnAmount || 0);
            salesReturnsTotal += rAmt;
            return {
                id: sr.id,
                orderId: sr.order?.orderId || '-',
                orderDbId: sr.orderId,
                returnAmount: rAmt,
                reason: sr.reason || 'Sales Return',
                createdAt: sr.createdAt,
                customerName: sr.order?.user?.businessProfile?.shopName || sr.order?.user?.fullname || sr.order?.customerName || 'Guest'
            };
        });

        // 7. Jama & Baki Wallet logs created today
        const jamaLogsToday = await PartyBalanceLog.findAll({
            where: { createdAt: dateFilter },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number'],
                    include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName'] }]
                },
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId']
                }
            ],
            distinct: true
        });

        // Deduplicate logs by orderId or log.id so each bill/order has only 1 balance log entry
        const uniqueJamaLogs = [];
        const seenOrderOrLogKeys = new Set();
        jamaLogsToday.forEach(log => {
            const oKey = (log.order?.orderId || log.orderId) ? `ORDER_${log.order?.orderId || log.orderId}` : `LOG_${log.id}`;
            if (!seenOrderOrLogKeys.has(oKey)) {
                seenOrderOrLogKeys.add(oKey);
                uniqueJamaLogs.push(log);
            }
        });

        let walletJamaTotal = 0;
        let walletBakiTotal = 0;
        const jamaAdjustmentsList = uniqueJamaLogs.map(log => {
            const lAmt = parseFloat(log.amount || 0);
            const typeUpper = String(log.type || '').toUpperCase();
            if (typeUpper.includes('JAMA') || typeUpper.includes('CREDIT')) {
                walletJamaTotal += lAmt;
            } else {
                walletBakiTotal += lAmt;
            }
            return {
                id: log.id,
                type: log.type,
                amount: lAmt,
                orderId: log.order?.orderId || log.orderId || '-',
                note: log.notes || log.description || log.note || 'Party Balance Log',
                createdAt: log.createdAt,
                customerName: log.user?.businessProfile?.shopName || log.user?.fullname || 'Guest',
                customerPhone: log.user?.number || '-'
            };
        });

        // Calculate overpaid and underpaid breakdown lists by summing today's OrderPayment collections per order
        const orderPaymentMap = {};
        allTodayPayments.forEach(p => {
            if (p.order) {
                const oid = p.order.id;
                if (!orderPaymentMap[oid]) {
                    orderPaymentMap[oid] = {
                        id: oid,
                        orderId: p.order.orderId,
                        totalAmount: parseFloat(p.order.totalAmount || 0),
                        paidToday: 0,
                        customerName: p.order.user?.businessProfile?.shopName || p.order.user?.fullname || p.order.customerName || 'Guest'
                    };
                }
                orderPaymentMap[oid].paidToday += parseFloat(p.amount || 0);
            }
        });

        const overpaidOrdersList = [];
        const underpaidOrdersList = [];

        Object.values(orderPaymentMap).forEach(item => {
            const diff = item.paidToday - item.totalAmount;
            if (diff > 0.01) {
                overpaidOrdersList.push({
                    id: item.id,
                    orderId: item.orderId,
                    customerName: item.customerName,
                    totalAmount: item.totalAmount,
                    paidAmount: item.paidToday,
                    extraAmount: parseFloat(diff.toFixed(2))
                });
            } else if (diff < -0.01) {
                underpaidOrdersList.push({
                    id: item.id,
                    orderId: item.orderId,
                    customerName: item.customerName,
                    totalAmount: item.totalAmount,
                    paidAmount: item.paidToday,
                    shortAmount: parseFloat(Math.abs(diff).toFixed(2))
                });
            }
        });

        const netDifference = totalReceived - todayDeliveredOrdersTotal;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Daily reconciliation report fetched.", {
            totalCashCollect: totalCashSum,
            totalOnlineCollect: totalOnlineSum,
            totalReceived,
            totalPendingDue: totalTodayPendingDueSum,
            allTimePendingDue: pendingDueOrdersFormatted.reduce((sum, o) => sum + o.dueAmount, 0),
            todayDeliveredOrdersTotal,
            netDifference,
            pastDuesClearedTotal,
            salesReturnsTotal,
            walletJamaTotal,
            walletBakiTotal,
            bankBreakdownList,
            todayDeliveredOrdersList,
            todayPendingDueOrdersList,
            pendingDueOrders: pendingDueOrdersFormatted,
            pastDuesClearedList,
            salesReturnsList,
            jamaAdjustmentsList,
            reconciliationExplanation: {
                todayDeliveredOrdersTotal,
                totalReceived,
                netDifference,
                salesReturnsTotal,
                walletJamaTotal,
                pendingDuesTotal: totalTodayPendingDueSum,
                pastDuesClearedTotal
            }
        });

    } catch (error) {
        logger.error(`[Get Daily Reconciliation Report Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update Order Payment Collection details (Admin edit from Daily Reconciliation Ledger)
 * @route   PUT /api/admin/payments/order/:orderId/collection
 * @access  Private (Admin)
 */
export const updateOrderCollectionDetails = async (req, res) => {
    const t = await Order.sequelize.transaction();
    try {
        const { orderId } = req.params;
        const { paidAmount, dueAmount, paymentMethod, note } = req.body;

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
        const orderWhere = isUuid ? { id: orderId } : { orderId };
        const order = await Order.findOne({ where: orderWhere, transaction: t });

        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const tot = parseFloat(order.totalAmount || 0);
        const newPaid = paidAmount !== undefined ? parseFloat(paidAmount) : parseFloat(order.paidAmount || 0);
        const newDue = dueAmount !== undefined ? parseFloat(dueAmount) : parseFloat(order.dueAmount || 0);

        order.paidAmount = newPaid;
        order.dueAmount = newDue;

        if (paymentMethod) {
            order.paymentMethod = paymentMethod;
        }

        if (newDue <= 0 && newPaid >= tot) {
            order.paymentStatus = 'Paid';
        } else if (newPaid > 0) {
            order.paymentStatus = 'Partial';
        } else {
            order.paymentStatus = 'Pending';
        }

        await order.save({ transaction: t });

        // Update or create main OrderPayment record for this order
        let mainPayment = await OrderPayment.findOne({
            where: { orderId: order.id },
            order: [['createdAt', 'DESC']],
            transaction: t
        });

        if (mainPayment) {
            mainPayment.amount = newPaid;
            if (paymentMethod) mainPayment.paymentMethod = paymentMethod;
            await mainPayment.save({ transaction: t });
        } else if (newPaid > 0) {
            await OrderPayment.create({
                orderId: order.id,
                amount: newPaid,
                paymentMethod: paymentMethod || order.paymentMethod || 'CASH',
                isSubmitted: true,
                submittedAt: new Date()
            }, { transaction: t });
        }

        await t.commit();

        logActivity(req, {
            module: 'Daily Reconciliation',
            action: 'UPDATE',
            description: `Updated collection for Order #${order.orderId}: Paid ₹${newPaid}, Due ₹${newDue}, Mode: ${paymentMethod || order.paymentMethod}`,
            metadata: { orderId: order.id, paidAmount: newPaid, dueAmount: newDue }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, `Order #${order.orderId} collection details updated successfully.`, {
            order: {
                id: order.id,
                orderId: order.orderId,
                totalAmount: tot,
                paidAmount: newPaid,
                dueAmount: newDue,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus
            }
        });

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Update Order Collection Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

