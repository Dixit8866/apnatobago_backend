import { Order, AppSettings } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * @desc    Initialize Razorpay Order for an existing order (Payment Collection)
 * @route   POST /api/delivery/payments/razorpay/initialize
 * @access  Private (Delivery Boy)
 */
export const initializeRazorpayOrder = async (req, res) => {
    try {
        const { orderId, amount } = req.body; // orderId can be UUID or human-readable ORD-ID

        if (!orderId || !amount || isNaN(amount) || amount <= 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Valid Order ID and amount are required.");
        }

        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
        let order;
        if (isUUID) {
            order = await Order.findByPk(orderId);
        } else {
            order = await Order.findOne({ where: { orderId: orderId } });
        }

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
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
            receipt: `receipt_${order.orderId}_${Date.now()}`,
        };

        const razorpayOrder = await razorpay.orders.create(options);

        // Update order with razorpayOrderId
        await order.update({ razorpayOrderId: razorpayOrder.id });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Razorpay order initialized.", {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: settings.razorpayKeyId,
            orderId: order.id,
            humanReadableOrderId: order.orderId
        });
    } catch (error) {
        const errMsg = error.message || (error.error && error.error.description) || JSON.stringify(error);
        logger.error(`[Delivery Razorpay Initialize Error]: ${errMsg}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, errMsg || "An unknown error occurred during Razorpay initialization");
    }
};

/**
 * @desc    Verify Razorpay Payment Signature and update order status
 * @route   POST /api/delivery/payments/razorpay/verify
 * @access  Private (Delivery Boy)
 */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId, amount } = req.body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !orderId) {
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
            // Update Order Payment Status
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
            let order;
            if (isUUID) {
                order = await Order.findByPk(orderId);
            } else {
                order = await Order.findOne({ where: { orderId: orderId } });
            }

            if (order) {
                // If amount is passed, we use it, otherwise we assume full payment
                const paymentAmount = amount ? parseFloat(amount) : parseFloat(order.totalAmount);
                const newPaidAmount = parseFloat(order.paidAmount) + paymentAmount;
                const newDueAmount = Math.max(0, parseFloat(order.totalAmount) - newPaidAmount);
                
                await order.update({
                    paymentStatus: newDueAmount <= 0 ? 'Paid' : 'Pending',
                    paidAmount: newPaidAmount,
                    dueAmount: newDueAmount,
                    razorpayPaymentId: razorpayPaymentId,
                    paymentMethod: 'ONLINE'
                });
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
