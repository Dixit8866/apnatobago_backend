import { Order, AppSettings, OrderPayment } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { Op } from 'sequelize';

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

        // Fetch Razorpay Keys from AppSettings
        const settings = await AppSettings.findOne();
        if (!settings || !settings.razorpayKeyId || !settings.razorpaySecretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay is not configured in settings.");
        }

        const razorpay = new Razorpay({
            key_id: settings.razorpayKeyId,
            key_secret: settings.razorpaySecretKey,
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
            keyId: settings.razorpayKeyId,
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
        if (!settings || !settings.razorpaySecretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay secret key not found.");
        }

        const body = razorpayOrderId + "|" + razorpayPaymentId;
        const expectedSignature = crypto
            .createHmac("sha256", settings.razorpaySecretKey)
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
