import { Cart, Product, ProductVariant, ProductPricing, Volume, Wishlist } from '../../models/index.js';
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
        const userAppLevel = req.user.applevel;

        const cartItemsRaw = await Cart.findAll({
            where: { userId },
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'thumbnail']
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    attributes: ['id', 'volume', 'image', 'baseUnitLabel', 'innerUnitLabel', 'purchasePrice', 'sellingVolume', 'baseUnitsPerPack'],
                    include: [
                        {
                            model: ProductPricing,
                            as: 'pricings',
                            attributes: ['customLevelId', 'minQty', 'maxQty', 'price', 'mrp']
                        },
                        { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                        { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // Fetch user's wishlist to mark items as wishlisted
        const wishlist = await Wishlist.findAll({
            where: { userId },
            attributes: ['productId']
        });
        const wishlistedProductIds = new Set(wishlist.map(w => w.productId));

        let itemTotal = 0;
        let totalMrp = 0;

        const formattedItems = cartItemsRaw.map(item => {
            const variant = item.variant;
            const product = item.product;

            if (!variant || !product) return null;

            const quantity = Number(item.quantity);

            // Find applicable pricing based on user's applevel and quantity
            let applicablePricing = variant.pricings.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );

            // Fallback: If no match for quantity, find any pricing for this level
            if (!applicablePricing) {
                applicablePricing = variant.pricings.find(p => p.customLevelId === userAppLevel);
            }

            // Ultimate fallback to first pricing
            let packLabel = variant.baseUnitLabel || 'pcs';
            let trueBaseLabelName = variant.innerUnitRef?.name 
              ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
              : (variant.volume || 'Unit');
            let bUPP = Number(variant.baseUnitsPerPack || 1);
            
            const rawPrice = applicablePricing ? Number(applicablePricing.price) : Number(variant.purchasePrice);
            const rawMrp = applicablePricing ? Number(applicablePricing.mrp) : rawPrice;

            // Price in DB is for 1 PACK (Dando). User buys in UNITS (Box).
            // So unitPrice = Price / Multiplier
            const unitPrice = rawPrice / bUPP;
            const unitMrp = rawMrp / bUPP;

            const totalPrice = unitPrice * quantity;
            const totalItemMrp = unitMrp * quantity;

            itemTotal += totalPrice;
            totalMrp += totalItemMrp;

            return {
                cartId: item.id,
                productId: product.id,
                variantId: variant.id,
                name: product.name,
                image: variant.image || product.thumbnail,
                thumbnail: variant.image || product.thumbnail,
                isWishlisted: wishlistedProductIds.has(product.id),
                volumeLabel: variant.volume,
                baseUnitLabel: variant.baseUnitRef?.name ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel) : variant.baseUnitLabel,
                innerUnitLabel: variant.innerUnitRef?.name ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel) : variant.innerUnitLabel,
                sellingVolume: variant.sellingVolume,
                quantity: quantity,
                unitPrice: unitPrice,
                mrp: unitMrp,
                totalPrice: Number(totalPrice.toFixed(2)),
                savings: Number((totalItemMrp - totalPrice).toFixed(2))
            };
        }).filter(item => item !== null);

        // Simple delivery logic (can be adjusted based on requirements)
        const deliveryCharges = 0;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart fetched successfully", {
            items: formattedItems,
            billDetails: {
                itemTotal: Number(itemTotal.toFixed(2)),
                deliveryCharges: Number(deliveryCharges.toFixed(2)),
                totalSavings: Number((totalMrp - itemTotal).toFixed(2)),
                grandTotal: Number((itemTotal + deliveryCharges).toFixed(2))
            }
        });
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
                return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from cart");
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

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart updated successfully", cartItem);
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
        const id = req.params.id || req.query.id;
        const { quantity } = req.body;

        if (!id) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide cart item ID");
        }

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
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from cart");
        }

        cartItem.quantity = Number(quantity);
        await cartItem.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart item updated successfully", cartItem);
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
        const id = req.params.id || req.query.id;

        if (!id) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide cart item ID");
        }

        const cartItem = await Cart.findOne({
            where: { id, userId }
        });

        if (!cartItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Cart item not found");
        }

        await cartItem.destroy();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from cart");
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

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart cleared successfully");
    } catch (error) {
        logger.error(`Error in clearCart: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
