import { Order, OrderItem, Product, ProductVariant, ProductPricing, Cart, User, AppSettings } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Generate a unique human-readable Order ID
 */
const generateUniqueOrderId = () => {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${timestamp}${random}`;
};

/**
 * @desc    Create a new order (Checkout)
 * @route   POST /api/user/orders
 * @access  Private
 */
export const createOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { 
            items, 
            paymentMethod, 
            deliveryOnRoundCharge = 0, 
            expressDeliveryCharge = 0,
            totalAmount: frontendTotalAmount // Total sent from frontend for validation
        } = req.body;
        
        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Order must contain at least one item.");
        }

        if (frontendTotalAmount === undefined || frontendTotalAmount === null) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Total amount is required for validation.");
        }

        let calculatedSubtotal = 0;
        const orderItemsData = [];

        for (const item of items) {
            const { productId, variantId, quantity } = item;

            // 1. Fetch Product and Variant
            const variant = await ProductVariant.findByPk(variantId, {
                include: [{ model: Product, as: 'product' }]
            });

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product variant ${variantId} not found.`);
            }

            // 2. Fetch all pricings for this variant
            const pricings = await ProductPricing.findAll({
                where: { variantId },
                order: [['minQty', 'ASC']]
            });

            // Find applicable pricing based on user's applevel and quantity
            let applicablePricing = pricings.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );

            // Fallback logic
            if (!applicablePricing) {
                applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
            }
            if (!applicablePricing && pricings.length > 0) {
                applicablePricing = pricings[0];
            }

            let itemPrice = 0;
            if (applicablePricing) {
                itemPrice = parseFloat(applicablePricing.price);
            } else {
                itemPrice = parseFloat(variant.purchasePrice) || 0;
            }

            const itemSubtotal = itemPrice * parseFloat(quantity);
            calculatedSubtotal += itemSubtotal;

            orderItemsData.push({
                productId,
                variantId,
                quantity,
                price: itemPrice,
                variantInfo: {
                    productName: variant.product.name,
                    volume: variant.volume,
                    image: variant.image || variant.product.thumbnail,
                    innerUnitLabel: variant.innerUnitLabel,
                    baseUnitLabel: variant.baseUnitLabel,
                    sellingVolume: variant.sellingVolume
                }
            });
        }

        // Calculate final total including delivery charges
        const deliveryCharge = parseFloat(deliveryOnRoundCharge) + parseFloat(expressDeliveryCharge);
        const finalCalculatedTotal = calculatedSubtotal + deliveryCharge;

        // Validation: Compare calculated total with frontend total
        // We use .toFixed(2) to avoid floating point comparison issues
        if (finalCalculatedTotal.toFixed(2) !== parseFloat(frontendTotalAmount).toFixed(2)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Price mismatch! Calculated: ${finalCalculatedTotal.toFixed(2)}, Received: ${parseFloat(frontendTotalAmount).toFixed(2)}`);
        }

        // 3. Handle Payment and Credit Line
        let paymentStatus = 'Pending';
        if (paymentMethod === 'Credit') {
            const user = await User.findByPk(userId, { transaction: t });
            if (!user) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
            }

            const currentCredit = parseFloat(user.creditline) || 0;
            if (currentCredit < finalCalculatedTotal) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Insufficient credit line. Available: ${currentCredit}, Required: ${finalCalculatedTotal}`);
            }

            // Deduct from credit line
            user.creditline = currentCredit - finalCalculatedTotal;
            await user.save({ transaction: t });
            paymentStatus = 'Paid';
        } else if (paymentMethod === 'Online') {
            paymentStatus = 'Paid'; // Marking as paid directly as requested
        } else {
            paymentStatus = 'Pending'; // For COD
        }

        // 4. Create the Order
        const newOrder = await Order.create({
            orderId: generateUniqueOrderId(),
            userId,
            totalAmount: finalCalculatedTotal,
            paymentMethod,
            paymentStatus,
            orderStatus: 'Pending',
            deliveryOnRoundCharge: parseFloat(deliveryOnRoundCharge),
            expressDeliveryCharge: parseFloat(expressDeliveryCharge)
        }, { transaction: t });

        // 5. Create Order Items
        const finalOrderItems = orderItemsData.map(item => ({
            ...item,
            orderId: newOrder.id
        }));

        await OrderItem.bulkCreate(finalOrderItems, { transaction: t });

        // 6. Clear Cart
        await Cart.destroy({ where: { userId }, transaction: t });

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Order placed successfully.", newOrder);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Create Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all orders for the logged-in user
 * @route   GET /api/user/orders
 * @access  Private
 */
export const getOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.query; // Check if a specific ID is requested

        const where = { userId };
        if (id) {
            where.id = id;
        }

        const orders = await Order.findAll({
            where,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'image'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders fetched successfully.", orders);
    } catch (error) {
        logger.error(`[Get Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get order details by ID
 * @route   GET /api/user/orders/:id
 * @access  Private
 */
export const getOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({
            where: { id, userId },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'image'] }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", order);
    } catch (error) {
        logger.error(`[Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Cancel an order
 * @route   PUT /api/user/orders/:id/cancel
 * @access  Private
 */
export const cancelOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const order = await Order.findOne({ where: { id, userId } });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        if (order.orderStatus !== 'Pending') {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Cannot cancel order in '${order.orderStatus}' status.`);
        }

        order.orderStatus = 'Cancelled';
        await order.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order cancelled successfully.", order);
    } catch (error) {
        logger.error(`[Cancel Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Initialize Razorpay Order
 * @route   POST /api/user/orders/razorpay/initialize
 * @access  Private
 */
export const initializeRazorpayOrder = async (req, res) => {
    try {
        const { amount } = req.body; // Amount in Rupees

        if (!amount || isNaN(amount) || amount <= 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid amount.");
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
            amount: Math.round(amount * 100), // Razorpay expects amount in paise (Rupees * 100)
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const razorpayOrder = await razorpay.orders.create(options);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Razorpay order initialized.", {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: settings.razorpayKeyId // Send Key ID to frontend for the Checkout SDK
        });
    } catch (error) {
        logger.error(`[Razorpay Initialize Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Verify Razorpay Payment Signature
 * @route   POST /api/user/orders/razorpay/verify
 * @access  Private
 */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

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
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment verified successfully.", { verified: true });
        } else {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid payment signature.");
        }
    } catch (error) {
        logger.error(`[Razorpay Verify Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
