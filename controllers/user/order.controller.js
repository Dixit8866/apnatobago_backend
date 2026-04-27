import { Order, OrderItem, Product, ProductVariant, User, Volume, Cart, AppSettings, InventoryStock, InventoryTransaction, Godown, AdminNotification, ProductPricing } from '../../models/index.js';
import { emitAdminNotification } from '../../socket.js';
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
            deliveryMode, 
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
            const { productId, variantId, quantity, sellUnit } = item;

            // 1. Fetch Product and Variant
            const variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ],
                transaction: t
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

            const bUPP = Number(variant.baseUnitsPerPack || 1);
            let rawPrice = 0;
            if (applicablePricing) {
                rawPrice = parseFloat(applicablePricing.price);
            } else {
                rawPrice = parseFloat(variant.purchasePrice) || 0;
            }

            // Logic: Price per pack vs Price per piece
            // If selling in pieces (Inner), we use price/bUPP. If in cartons (Base), we use rawPrice.
            const itemPrice = sellUnit === 'Inner' ? (rawPrice / bUPP) : rawPrice;
            const itemSubtotal = itemPrice * parseFloat(quantity);
            calculatedSubtotal += itemSubtotal;

            orderItemsData.push({
                productId,
                variantId,
                quantity,
                price: itemPrice,
                sellUnit, // Important: Store the unit purchased
                variantInfo: {
                    productName: variant.product.name,
                    volume: variant.volume,
                    image: variant.image || variant.product.thumbnail,
                    innerUnitLabel: variant.innerUnitRef?.name 
                        ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                        : variant.innerUnitLabel,
                    baseUnitLabel: variant.baseUnitRef?.name
                        ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                        : variant.baseUnitLabel,
                    sellingVolume: variant.sellingVolume
                }
            });
        }

        // 3. Calculate delivery charge and final total
        const settings = await AppSettings.findOne({ transaction: t });
        let deliveryCharge = 0;
        if (settings && calculatedSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
            if (deliveryMode === 'Express') deliveryCharge = parseFloat(settings.expressDeliveryCharge);
            else if (deliveryMode === 'Round') deliveryCharge = parseFloat(settings.deliveryOnRoundCharge);
        }

        // Calculate final total (Subtotal + Delivery Charge)
        const backendTotal = calculatedSubtotal + deliveryCharge;
        
        // Validate with frontend total (allowing for small rounding differences)
        if (frontendTotalAmount && Math.abs(parseFloat(frontendTotalAmount) - backendTotal) > 1) {
            logger.warn(`[Order Total Discrepancy]: Frontend: ${frontendTotalAmount}, Backend: ${backendTotal} for User: ${userId}`);
        }

        const finalTotal = backendTotal;

        // 4. Handle Payment and Credit Line
        let paymentStatus = 'Pending';
        const method = paymentMethod?.toUpperCase();

        if (method === 'CREDIT') {
            const user = await User.findByPk(userId, { transaction: t });
            if (!user) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
            }

            const currentCredit = parseFloat(user.creditline) || 0;
            if (currentCredit < finalTotal) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Insufficient credit line. Available: ${currentCredit}, Required: ${finalTotal}`);
            }

            // Deduct from credit line
            user.creditline = currentCredit - finalTotal;
            await user.save({ transaction: t });
            paymentStatus = 'Paid';
        } else if (method === 'ONLINE') {
            paymentStatus = 'Paid';
        } else {
            paymentStatus = 'Pending';
        }

        // 5. Create the Order
        const newOrder = await Order.create({
            orderId: generateUniqueOrderId(),
            userId,
            totalAmount: finalTotal,
            paidAmount: paymentStatus === 'Paid' ? finalTotal : 0,
            dueAmount: paymentStatus === 'Paid' ? 0 : finalTotal,
            paymentMethod,
            paymentStatus,
            orderStatus: 'Pending',
            deliveryMode,
            deliveryCharge
        }, { transaction: t });

        // 6. Create Order Items
        const finalOrderItems = orderItemsData.map(item => ({
            ...item,
            orderId: newOrder.id
        }));

        await OrderItem.bulkCreate(finalOrderItems, { transaction: t });

        // 7. Clear Cart
        await Cart.destroy({ where: { userId }, transaction: t });

        // 8. Deduct Stock from Inventory
        const userData = await User.findByPk(userId, { transaction: t });
        let targetGodownId = null;

        if (userData.postcode) {
            const godown = await Godown.findOne({
                where: { pincodes: { [Op.contains]: [userData.postcode] } },
                transaction: t
            });
            if (godown) targetGodownId = godown.id;
        }

        if (!targetGodownId) {
            const mainGodown = await Godown.findOne({ where: { type: 'main' }, transaction: t });
            if (mainGodown) targetGodownId = mainGodown.id;
        }

        if (!targetGodownId) {
            const anyGodown = await Godown.findOne({ transaction: t });
            if (anyGodown) targetGodownId = anyGodown.id;
        }

        if (targetGodownId) {
            for (const item of orderItemsData) {
                const variant = await ProductVariant.findByPk(item.variantId, { transaction: t });
                if (!variant) continue;

                // How many base units to deduct?
                // If selling pieces (Inner), deduct quantity directly. 
                // If selling cartons (Base), deduct quantity * unitsPerPack.
                const deductionRequired = item.sellUnit === 'Inner' 
                    ? item.quantity 
                    : item.quantity * (variant.baseUnitsPerPack || 1);
                
                // Find available stock batches for this variant in the target godown (FIFO)
                const stocks = await InventoryStock.findAll({
                    where: { 
                        variantId: item.variantId, 
                        godownId: targetGodownId, 
                        totalBaseUnits: { [Op.gt]: 0 } 
                    },
                    order: [['createdAt', 'ASC']],
                    transaction: t
                });

                let remainingToDeduct = deductionRequired;
                for (const stock of stocks) {
                    if (remainingToDeduct <= 0) break;

                    const deductFromThis = Math.min(stock.totalBaseUnits, remainingToDeduct);
                    const newTotalBaseUnits = stock.totalBaseUnits - deductFromThis;
                    
                    await stock.update({ totalBaseUnits: newTotalBaseUnits }, { transaction: t });

                    // Log the transaction
                    await InventoryTransaction.create({
                        stockId: stock.id,
                        productId: item.productId,
                        variantId: item.variantId,
                        godownId: targetGodownId,
                        type: 'SALE',
                        primaryUnitId: stock.primaryUnitId,
                        secondaryUnitId: stock.secondaryUnitId,
                        secondaryPerPrimary: stock.secondaryPerPrimary,
                        totalQtyBaseUnits: deductFromThis,
                        balanceAfterBaseUnits: newTotalBaseUnits,
                        note: `Sales Order #${newOrder.orderId}`
                    }, { transaction: t });

                    remainingToDeduct -= deductFromThis;
                }
                
                if (remainingToDeduct > 0) {
                    logger.warn(`[Stock Deduction]: Order #${newOrder.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId} in Godown ${targetGodownId}`);
                }
            }
        } else {
            logger.error(`[Stock Deduction]: No Godown found to deduct stock for Order #${newOrder.orderId}`);
        }

        await t.commit();

        // 9. Trigger Admin Notification (Real-time)
        try {
            console.log('Creating AdminNotification for Order:', newOrder.orderId);
            const adminNotify = await AdminNotification.create({
                title: 'New Order Received!',
                message: `User ${userData.fullname} has placed a new order #${newOrder.orderId} of ₹${newOrder.totalAmount}.`,
                type: 'ORDER',
                referenceId: newOrder.id,
                clickAction: `/sales/user-orders`
            });
            console.log('AdminNotification created successfully:', adminNotify.id);
            emitAdminNotification(adminNotify);
        } catch (notifyErr) {
            console.error('[Admin Notification Error]:', notifyErr);
            logger.error(`[Admin Notification Error]: ${notifyErr.message}`);
        }

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
                        { 
                            model: ProductVariant, 
                            as: 'variant', 
                            attributes: ['id', 'volume', 'image'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
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
                        { 
                            model: ProductVariant, 
                            as: 'variant', 
                            attributes: ['id', 'volume', 'image'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
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

/**
 * @desc    Get orders with payment status details for the user
 * @route   GET /api/user/orders/payment-status
 * @access  Private
 */
export const getOrdersWithPaymentStatus = async (req, res) => {
    try {
        const userId = req.user.id;

        const orders = await Order.findAll({
            where: { userId },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        { 
                            model: ProductVariant, 
                            as: 'variant', 
                            attributes: ['id', 'volume', 'image'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment status data fetched successfully.", orders);
    } catch (error) {
        logger.error(`[Get Payment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
