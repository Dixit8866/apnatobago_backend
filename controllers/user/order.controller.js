import { Order, OrderItem, Product, ProductVariant, ProductPricing, Cart, User } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';

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
        const { items, paymentMethod, shippingAddress, notes } = req.body;
        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Order must contain at least one item.");
        }

        let totalAmount = 0;
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

            // Find applicable pricing based on user's applevel and quantity (Same logic as Cart)
            let applicablePricing = pricings.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );

            // Fallback 1: If no match for quantity, find any pricing for this level
            if (!applicablePricing) {
                applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
            }

            // Fallback 2: Ultimate fallback to first pricing available if still no match
            if (!applicablePricing && pricings.length > 0) {
                applicablePricing = pricings[0];
            }

            let itemPrice = 0;
            if (applicablePricing) {
                itemPrice = parseFloat(applicablePricing.price);
            } else {
                // Last resort: use variant's purchasePrice if no pricing configured at all
                itemPrice = parseFloat(variant.purchasePrice) || 0;
            }

            const itemSubtotal = itemPrice * parseFloat(quantity);
            totalAmount += itemSubtotal;

            orderItemsData.push({
                productId,
                variantId,
                quantity,
                price: itemPrice,
                variantInfo: {
                    productName: variant.product.name,
                    volume: variant.volume,
                    image: variant.image || variant.product.thumbnail
                }
            });
        }

        // 3. Create the Order
        const newOrder = await Order.create({
            orderId: generateUniqueOrderId(),
            userId,
            totalAmount,
            paymentMethod,
            paymentStatus: paymentMethod === 'COD' ? 'Pending' : 'Pending', // Adjust based on gateway
            orderStatus: 'Pending',
            shippingAddress,
            notes
        }, { transaction: t });

        // 4. Create Order Items
        const finalOrderItems = orderItemsData.map(item => ({
            ...item,
            orderId: newOrder.id
        }));

        await OrderItem.bulkCreate(finalOrderItems, { transaction: t });

        // 5. Clear Cart (Optional: only if checkout is from cart)
        // If items are coming from cart, we might want to clear them
        // For now, let's assume if it's a direct purchase we don't clear everything, 
        // but typically checkout clears the cart.
        await Cart.destroy({ where: { userId }, transaction: t });

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Order placed successfully.", newOrder);
    } catch (error) {
        await t.rollback();
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
        const orders = await Order.findAll({
            where: { userId },
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
