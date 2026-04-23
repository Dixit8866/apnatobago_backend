import { Cart, Product, ProductVariant, ProductPricing, MainCategory, SubCategory, CompanyCategory, Volume, CustomLevel } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get current user's cart
 * @route   GET /api/user/cart
 * @access  Private (User)
 */
export const getCart = async (req, res) => {
    try {
        const userId = req.user.id;

        const cartItems = await Cart.findAll({
            where: { userId },
            include: [
                {
                    model: Product,
                    as: 'product',
                    include: [
                        { model: MainCategory, as: 'mainCategory' },
                        { model: SubCategory, as: 'subCategory' },
                        { model: CompanyCategory, as: 'companyCategory' }
                    ]
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    include: [
                        { model: Volume, as: 'volumeRef' },
                        { 
                            model: ProductPricing, 
                            as: 'pricings',
                            include: [{ model: CustomLevel, as: 'customLevel' }]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, "Cart fetched successfully", cartItems);
    } catch (error) {
        logger.error(`Error in getCart: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Add item to cart or update quantity (incremental)
 * @route   POST /api/user/cart
 * @access  Private (User)
 */
export const addToCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId, variantId, quantity } = req.body;

        if (!productId || !variantId || quantity === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide product, variant and quantity");
        }

        // Check if item already exists in cart
        let cartItem = await Cart.findOne({
            where: { userId, productId, variantId }
        });

        if (cartItem) {
            // Update existing quantity (incremental)
            const newQty = Number(cartItem.quantity) + Number(quantity);
            if (newQty <= 0) {
                await cartItem.destroy();
                return sendSuccessResponse(res, "Item removed from cart");
            }
            cartItem.quantity = newQty;
            await cartItem.save();
        } else {
            // Create new cart item
            if (Number(quantity) <= 0) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Quantity must be greater than zero");
            }
            cartItem = await Cart.create({
                userId,
                productId,
                variantId,
                quantity: Number(quantity)
            });
        }

        return sendSuccessResponse(res, "Cart updated successfully", cartItem);
    } catch (error) {
        logger.error(`Error in addToCart: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update cart item quantity (set exact)
 * @route   PUT /api/user/cart/:id
 * @access  Private (User)
 */
export const updateCartItem = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;
        const { quantity } = req.body;

        if (quantity === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide quantity");
        }

        const cartItem = await Cart.findOne({
            where: { id, userId }
        });

        if (!cartItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Cart item not found");
        }

        if (Number(quantity) <= 0) {
            await cartItem.destroy();
            return sendSuccessResponse(res, "Item removed from cart");
        }

        cartItem.quantity = Number(quantity);
        await cartItem.save();

        return sendSuccessResponse(res, "Cart item updated successfully", cartItem);
    } catch (error) {
        logger.error(`Error in updateCartItem: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Remove item from cart
 * @route   DELETE /api/user/cart/:id
 * @access  Private (User)
 */
export const removeFromCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id } = req.params;

        const cartItem = await Cart.findOne({
            where: { id, userId }
        });

        if (!cartItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Cart item not found");
        }

        await cartItem.destroy();

        return sendSuccessResponse(res, "Item removed from cart");
    } catch (error) {
        logger.error(`Error in removeFromCart: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Clear cart
 * @route   DELETE /api/user/cart/clear
 * @access  Private (User)
 */
export const clearCart = async (req, res) => {
    try {
        const userId = req.user.id;

        await Cart.destroy({
            where: { userId }
        });

        return sendSuccessResponse(res, "Cart cleared successfully");
    } catch (error) {
        logger.error(`Error in clearCart: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
