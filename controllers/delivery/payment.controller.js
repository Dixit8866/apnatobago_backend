import { Order, AppSettings, OrderPayment, User, BusinessProfile, BankSetting } from '../../models/index.js';
import sequelize from '../../config/db.js';
import { restoreUserCreditFromPayment } from './order.controller.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { getPaginationOptions } from '../../helpers/query.helper.js';

/**
 * @desc    Initialize Razorpay Order for single or multiple existing orders (Payment Collection)
 * @route   POST /api/delivery/payments/razorpay/initialize
 * @access  Private (Delivery Boy)
 */
export const initializeRazorpayOrder = async (req, res) => {
    try {
        const { orderId, amount } = req.body; // orderId can be single string/UUID, array of IDs, or comma-separated string
        logger.info(`[Delivery Razorpay Initialize]: OrderID(s): ${JSON.stringify(orderId)}, Amount: ${amount}`);

        if (!orderId || !amount || isNaN(amount) || amount <= 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Valid Order ID(s) and amount are required.");
        }

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
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No valid order ID provided.");
        }

        // Find all specified orders
        const orders = await Order.findAll({
            where: {
                [Op.or]: orConditions
            }
        });

        if (orders.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "No orders found.");
        }

        // Fetch Razorpay Keys from AppSettings with environment fallback
        const settings = await AppSettings.findOne();
        const keyId = settings?.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
        const secretKey = settings?.razorpaySecretKey || process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !secretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay is not configured in settings.");
        }

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: secretKey,
        });

        const options = {
            amount: Math.round(amount * 100), // Razorpay expects amount in paise
            currency: "INR",
            receipt: `receipt_${orders[0].orderId || 'multi'}_${Date.now()}`,
        };

        const razorpayOrder = await razorpay.orders.create(options);

        // Update all orders with razorpayOrderId
        await Promise.all(orders.map(order => order.update({ razorpayOrderId: razorpayOrder.id })));
        logger.info(`[Delivery Razorpay Initialize]: Razorpay Order ${razorpayOrder.id} created for ${orders.length} orders.`);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Razorpay order initialized.", {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: keyId,
            orderIds: orders.map(o => o.id),
            humanReadableOrderIds: orders.map(o => o.orderId)
        });
    } catch (error) {
        const errMsg = error.message || (error.error && error.error.description) || JSON.stringify(error);
        logger.error(`[Delivery Razorpay Initialize Error]: ${errMsg}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, errMsg || "An unknown error occurred during Razorpay initialization");
    }
};

/**
 * @desc    Verify Razorpay Payment Signature and update order status for single or multiple orders
 * @route   POST /api/delivery/payments/razorpay/verify
 * @access  Private (Delivery Boy)
 */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId, amount } = req.body;
        const deliveryBoyId = req.user.id;
        logger.info(`[Delivery Razorpay Verify]: OrderID: ${JSON.stringify(orderId)}, RazorpayPaymentID: ${razorpayPaymentId}, Amount: ${amount}`);

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing payment details.");
        }

        const settings = await AppSettings.findOne();
        const secretKey = settings?.razorpaySecretKey || process.env.RAZORPAY_KEY_SECRET;
        if (!secretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay secret key not found.");
        }

        const body = razorpayOrderId + "|" + razorpayPaymentId;
        const expectedSignature = crypto
            .createHmac("sha256", secretKey)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature === razorpaySignature) {
            // Find all orders associated with this razorpayOrderId
            let orders = await Order.findAll({
                where: { razorpayOrderId: razorpayOrderId }
            });

            // Fallback to orderId if no orders found by razorpayOrderId
            if (orders.length === 0 && orderId) {
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

                if (orConditions.length > 0) {
                    orders = await Order.findAll({
                        where: {
                            [Op.or]: orConditions
                        }
                    });
                }
            }

            if (orders.length === 0) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "No orders found to update.");
            }

            // Sort oldest first for chronological auto-adjustment
            orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            let remainingOnline = amount ? parseFloat(amount) : orders.reduce((sum, o) => sum + parseFloat(o.dueAmount), 0);
            
            for (const order of orders) {
                let due = parseFloat(order.dueAmount);
                if (due <= 0) continue;
                if (remainingOnline <= 0) break;

                const deduction = Math.min(remainingOnline, due);
                remainingOnline -= deduction;
                due -= deduction;

                const newPaidAmount = parseFloat(order.paidAmount) + deduction;

                let newPaymentStatus = 'Pending';
                if (due <= 1e-7) {
                    newPaymentStatus = 'Paid';
                } else if (newPaidAmount > 0) {
                    newPaymentStatus = 'Partial';
                }

                let finalMethod = order.paymentMethod;
                if (order.paymentMethod && order.paymentMethod !== 'ONLINE') {
                    finalMethod = 'SPLIT';
                } else {
                    finalMethod = 'ONLINE';
                }

                let newNotes = order.notes ? order.notes + '\n' : '';
                newNotes += `[${new Date().toLocaleString()}] Paid ${deduction} via Online (Razorpay Txn: ${razorpayPaymentId})`;

                await order.update({
                    paymentStatus: newPaymentStatus,
                    paidAmount: newPaidAmount,
                    dueAmount: due,
                    razorpayPaymentId: razorpayPaymentId,
                    paymentMethod: finalMethod,
                    notes: newNotes
                });

                // Create OrderPayment record!
                await OrderPayment.create({
                    orderId: order.id,
                    deliveryBoyId,
                    amount: deduction,
                    paymentMethod: 'ONLINE',
                    transactionId: razorpayPaymentId,
                    notes: 'Auto-adjusted via online payment collection'
                });

                // Restore user's credit from this online payment
                if (order.userId) {
                    const user = await User.findByPk(order.userId);
                    if (user) {
                        await restoreUserCreditFromPayment(order.id, deduction, user);
                        await user.save();
                    }
                }

                logger.info(`[Delivery Razorpay Verify]: Order ${order.id} updated with payment ${razorpayPaymentId}. New Due: ${due}`);
            }

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment verified successfully.", { verified: true });
        } else {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid payment signature.");
        }
    } catch (error) {
        logger.error(`[Delivery Razorpay Verify Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * Helper to get the start and end of the current day in Indian Standard Time (IST),
 * returned as UTC Date objects for database querying.
 */
const getTodayRangeIST = () => {
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    
    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const date = istTime.getUTCDate();
    
    const istStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
    const todayStart = new Date(istStart.getTime() - (5.5 * 60 * 60 * 1000));
    
    const istEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
    const todayEnd = new Date(istEnd.getTime() - (5.5 * 60 * 60 * 1000));
    
    return { todayStart, todayEnd };
};

/**
 * @desc    Get detailed breakdown of today's collected payments (Cash, Online, Credit) with shopwise details
 * @route   GET /api/delivery/payments/collected
 * @access  Private (Delivery Boy Only)
 */
export const getCollectedPayments = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        const { todayStart, todayEnd } = getTodayRangeIST();

        logger.info(`[Delivery Payments]: Fetching collected payments for rider ${req.user.name} (${deliveryBoyId})`);

        // 1. Fetch ALL payments collected today to calculate overall totals (unpaginated)
        const allPayments = await OrderPayment.findAll({
            where: {
                deliveryBoyId,
                createdAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });

        let cashTotal = 0;
        let onlineTotal = 0;
        let creditTotal = 0;

        allPayments.forEach(payment => {
            const amount = parseFloat(payment.amount || 0);
            const method = payment.paymentMethod?.toUpperCase();
            if (method === 'CASH') cashTotal += amount;
            else if (method === 'ONLINE') onlineTotal += amount;
            else if (method === 'CREDIT') creditTotal += amount;
        });

        // 2. Fetch paginated payments for list details
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const payments = await OrderPayment.findAll({
            where: {
                deliveryBoyId,
                createdAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            },
            include: [
                {
                    model: Order,
                    as: 'order',
                    include: [
                        {
                            model: User,
                            as: 'user',
                            include: [
                                {
                                    model: BusinessProfile,
                                    as: 'businessProfile'
                                }
                            ]
                        }
                    ]
                }
            ],
            ...(req.query.paginate !== 'false' ? { limit, offset } : {}),
            order: [['createdAt', 'DESC']]
        });

        const shopwiseMasterMap = {};

        payments.forEach(payment => {
            const amount = parseFloat(payment.amount || 0);
            const method = payment.paymentMethod?.toUpperCase();

            // Extract shop details fallback to customer name or guest
            const shopName = payment.order?.user?.businessProfile?.shopName || payment.order?.customerName || 'Guest';
            const shopId = payment.order?.userId || 'guest';

            if (!shopwiseMasterMap[shopName]) {
                shopwiseMasterMap[shopName] = {
                    shopName,
                    shopId,
                    cash: 0,
                    online: 0,
                    credit: 0,
                    total: 0
                };
            }

            if (method === 'CASH') {
                shopwiseMasterMap[shopName].cash += amount;
            } else if (method === 'ONLINE') {
                shopwiseMasterMap[shopName].online += amount;
            } else if (method === 'CREDIT') {
                shopwiseMasterMap[shopName].credit += amount;
            }
            shopwiseMasterMap[shopName].total += amount;
        });

        const combinedList = Object.values(shopwiseMasterMap).map(item => ({
            shopName: item.shopName,
            shopId: item.shopId,
            cash: parseFloat(item.cash.toFixed(2)),
            online: parseFloat(item.online.toFixed(2)),
            credit: parseFloat(item.credit.toFixed(2)),
            total: parseFloat(item.total.toFixed(2))
        }));

        const cashList = [];
        const onlineList = [];
        const creditList = [];

        combinedList.forEach(item => {
            if (item.cash > 0) {
                cashList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.cash,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
            if (item.online > 0) {
                onlineList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.online,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
            if (item.credit > 0) {
                creditList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.credit,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
        });

        const responseData = {
            totals: {
                cash: parseFloat(cashTotal.toFixed(2)),
                online: parseFloat(onlineTotal.toFixed(2)),
                credit: parseFloat(creditTotal.toFixed(2))
            },
            shopwise: {
                CASH: cashList,
                ONLINE: onlineList,
                CREDIT: creditList
            },
            combined: combinedList
        };

        if (req.query.paginate !== 'false') {
            responseData.totalRecords = allPayments.length;
            responseData.totalPages = Math.ceil(allPayments.length / limit);
            responseData.currentPage = page;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Collected payments fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Delivery Collected Payments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get detailed breakdown of today's verified/submitted payments (Cash, Online, Credit) with shopwise details
 * @route   GET /api/delivery/payments/submitted
 * @access  Private (Delivery Boy Only)
 */
export const getSubmittedPayments = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        const { todayStart, todayEnd } = getTodayRangeIST();

        logger.info(`[Delivery Payments]: Fetching submitted payments for rider ${req.user.name} (${deliveryBoyId})`);

        // 1. Fetch ALL payments submitted today to calculate overall totals (unpaginated)
        const allPayments = await OrderPayment.findAll({
            where: {
                deliveryBoyId,
                isSubmitted: true,
                [Op.or]: [
                    {
                        submittedAt: {
                            [Op.between]: [todayStart, todayEnd]
                        }
                    },
                    {
                        createdAt: {
                            [Op.between]: [todayStart, todayEnd]
                        }
                    }
                ]
            }
        });

        let cashTotal = 0;
        let onlineTotal = 0;
        let creditTotal = 0;

        allPayments.forEach(payment => {
            const amount = parseFloat(payment.amount || 0);
            const method = payment.paymentMethod?.toUpperCase();
            if (method === 'CASH') cashTotal += amount;
            else if (method === 'ONLINE') onlineTotal += amount;
            else if (method === 'CREDIT') creditTotal += amount;
        });

        // 2. Fetch paginated payments for list details
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const payments = await OrderPayment.findAll({
            where: {
                deliveryBoyId,
                isSubmitted: true,
                [Op.or]: [
                    {
                        submittedAt: {
                            [Op.between]: [todayStart, todayEnd]
                        }
                    },
                    {
                        createdAt: {
                            [Op.between]: [todayStart, todayEnd]
                        }
                    }
                ]
            },
            include: [
                {
                    model: Order,
                    as: 'order',
                    include: [
                        {
                            model: User,
                            as: 'user',
                            include: [
                                {
                                    model: BusinessProfile,
                                    as: 'businessProfile'
                                }
                            ]
                        }
                    ]
                }
            ],
            ...(req.query.paginate !== 'false' ? { limit, offset } : {}),
            order: [['updatedAt', 'DESC']]
        });

        const shopwiseMasterMap = {};

        payments.forEach(payment => {
            const amount = parseFloat(payment.amount || 0);
            const method = payment.paymentMethod?.toUpperCase();

            // Extract shop details fallback to customer name or guest
            const shopName = payment.order?.user?.businessProfile?.shopName || payment.order?.customerName || 'Guest';
            const shopId = payment.order?.userId || 'guest';

            if (!shopwiseMasterMap[shopName]) {
                shopwiseMasterMap[shopName] = {
                    shopName,
                    shopId,
                    cash: 0,
                    online: 0,
                    credit: 0,
                    total: 0
                };
            }

            if (method === 'CASH') {
                shopwiseMasterMap[shopName].cash += amount;
            } else if (method === 'ONLINE') {
                shopwiseMasterMap[shopName].online += amount;
            } else if (method === 'CREDIT') {
                shopwiseMasterMap[shopName].credit += amount;
            }
            shopwiseMasterMap[shopName].total += amount;
        });

        const combinedList = Object.values(shopwiseMasterMap).map(item => ({
            shopName: item.shopName,
            shopId: item.shopId,
            cash: parseFloat(item.cash.toFixed(2)),
            online: parseFloat(item.online.toFixed(2)),
            credit: parseFloat(item.credit.toFixed(2)),
            total: parseFloat(item.total.toFixed(2))
        }));

        const cashList = [];
        const onlineList = [];
        const creditList = [];

        combinedList.forEach(item => {
            if (item.cash > 0) {
                cashList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.cash,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
            if (item.online > 0) {
                onlineList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.online,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
            if (item.credit > 0) {
                creditList.push({
                    shopName: item.shopName,
                    shopId: item.shopId,
                    amount: item.credit,
                    cash: item.cash,
                    online: item.online,
                    credit: item.credit,
                    total: item.total
                });
            }
        });

        const responseData = {
            totals: {
                cash: parseFloat(cashTotal.toFixed(2)),
                online: parseFloat(onlineTotal.toFixed(2)),
                credit: parseFloat(creditTotal.toFixed(2))
            },
            shopwise: {
                CASH: cashList,
                ONLINE: onlineList,
                CREDIT: creditList
            },
            combined: combinedList
        };

        if (req.query.paginate !== 'false') {
            responseData.totalRecords = allPayments.length;
            responseData.totalPages = Math.ceil(allPayments.length / limit);
            responseData.currentPage = page;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Submitted payments fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Delivery Submitted Payments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get assigned bank settings/details for a delivery boy (using authenticated id or request parameter query)
 * @route   GET /api/delivery/payments/bank-details
 * @access  Private (Delivery Boy Only)
 */
export const getDeliveryBoyBankDetails = async (req, res) => {
    try {
        const deliveryBoyId = req.query.deliveryBoyId || req.user.id;
        logger.info(`[Delivery Bank Details]: Fetching bank details for delivery boy ID: ${deliveryBoyId}`);

        if (!deliveryBoyId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Delivery boy ID is required.");
        }

        const bankDetails = await BankSetting.findAll({
            where: {
                status: 'Active',
                [Op.or]: [
                    { deliveryBoyId },
                    sequelize.literal(`"deliveryBoyIds" @> '["${deliveryBoyId}"]'::jsonb`)
                ]
            },
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank details fetched successfully.", bankDetails);
    } catch (error) {
        logger.error(`[Delivery Get Bank Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

