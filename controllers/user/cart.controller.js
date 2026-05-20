import { Cart, Product, ProductVariant, ProductPricing, Volume, Wishlist, InventoryStock, User, Godown } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { Op } from 'sequelize';

// Helper to get available stock of a product across all its variants in the customer's postcode-specific/main godown
const getAvailableStock = async (productId, userId) => {
    const userData = await User.findByPk(userId);
    if (!userData) return 0;

    let targetGodownId = null;
    if (userData.postcode) {
        const godown = await Godown.findOne({
            where: { pincodes: { [Op.contains]: [userData.postcode] } }
        });
        if (godown) targetGodownId = godown.id;
    }

    if (!targetGodownId) {
        const mainGodown = await Godown.findOne({ where: { type: 'main' } });
        if (mainGodown) targetGodownId = mainGodown.id;
    }

    if (!targetGodownId) {
        const anyGodown = await Godown.findOne();
        if (anyGodown) targetGodownId = anyGodown.id;
    }

    if (!targetGodownId) return 0;

    const totalStock = await InventoryStock.sum('totalBaseUnits', {
        where: {
            productId,
            godownId: targetGodownId,
            totalBaseUnits: { [Op.gt]: 0 }
        }
    });

    return parseFloat(totalStock) || 0;
};

/**
 * @desc    Get current user's cart
 * @route   GET /api/user/cart
 * @access  Private (User)
 */
export const getCart = async (req, res) => {
    try {
        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        let cartItemsRaw = await Cart.findAll({
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

        // Healing soft-deleted variants in cart items
        let healedAny = false;
        for (const item of cartItemsRaw) {
            if (!item.variant && item.productId) {
                const deletedVariant = await ProductVariant.findByPk(item.variantId, { paranoid: false });
                if (deletedVariant) {
                    let activeVariant = await ProductVariant.findOne({
                        where: {
                            productId: deletedVariant.productId,
                            volumeId: deletedVariant.volumeId,
                            status: 'Active'
                        }
                    });
                    if (!activeVariant) {
                        activeVariant = await ProductVariant.findOne({
                            where: {
                                productId: deletedVariant.productId,
                                status: 'Active'
                            }
                        });
                    }
                    if (activeVariant) {
                        // Check if another cart item already exists with this active variant
                        const existingCartItem = await Cart.findOne({
                            where: { userId, productId: item.productId, variantId: activeVariant.id }
                        });
                        if (existingCartItem) {
                            // Merge quantities
                            existingCartItem.quantity = Number(existingCartItem.quantity) + Number(item.quantity);
                            await existingCartItem.save();
                            await item.destroy();
                        } else {
                            // Point old cart item to new variant
                            item.variantId = activeVariant.id;
                            await item.save();
                        }
                        healedAny = true;
                    }
                }
            }
        }

        if (healedAny) {
            // Re-fetch populated cart
            cartItemsRaw = await Cart.findAll({
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
        }

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

        // Paginate items based on page and limit query parameters if provided
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const startIndex = (page - 1) * limit;
        const endIndex = page * limit;
        const paginatedItems = (req.query.page || req.query.limit)
            ? formattedItems.slice(startIndex, endIndex)
            : formattedItems;

        // Simple delivery logic (can be adjusted based on requirements)
        const deliveryCharges = 0;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart fetched successfully", {
            items: paginatedItems,
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

        // Fetch variant to calculate base units required
        let variant = await ProductVariant.findByPk(variantId);
        let resolvedVariantId = variantId;
        if (!variant) {
            const deletedVariant = await ProductVariant.findByPk(variantId, { paranoid: false });
            if (deletedVariant) {
                let activeVariant = await ProductVariant.findOne({
                    where: {
                        productId: deletedVariant.productId,
                        volumeId: deletedVariant.volumeId,
                        status: 'Active'
                    }
                });
                if (!activeVariant) {
                    activeVariant = await ProductVariant.findOne({
                        where: {
                            productId: deletedVariant.productId,
                            status: 'Active'
                        }
                    });
                }
                if (activeVariant) {
                    variant = activeVariant;
                    resolvedVariantId = activeVariant.id;
                }
            }
        }

        if (!variant) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found");
        }

        const bUPP = Number(variant.baseUnitsPerPack || 1);
        const qtyToAdd = Number(quantity);

        // Check if item already exists in cart
        let cartItem = await Cart.findOne({
            where: { userId, productId, variantId: resolvedVariantId }
        });

        const currentCartQty = cartItem ? Number(cartItem.quantity) : 0;
        const totalProposedQty = currentCartQty + qtyToAdd;

        const deductionRequired = variant.sellingVolume 
            ? totalProposedQty * Number(variant.sellingVolume) * bUPP
            : totalProposedQty * bUPP;

        // Check stock first (at product level)
        const availableStock = await getAvailableStock(productId, userId);

        if (deductionRequired > availableStock) {
            return sendErrorResponse(
                res, 
                HTTP_STATUS.BAD_REQUEST, 
                `Insufficient stock. Available stock: ${availableStock} base units. Your cart requires: ${deductionRequired} base units.`
            );
        }

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
                variantId: resolvedVariantId,
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

        const proposedQty = Number(quantity);
        if (proposedQty > 0) {
            let variant = await ProductVariant.findByPk(cartItem.variantId);
            if (!variant) {
                const deletedVariant = await ProductVariant.findByPk(cartItem.variantId, { paranoid: false });
                if (deletedVariant) {
                    let activeVariant = await ProductVariant.findOne({
                        where: {
                            productId: deletedVariant.productId,
                            volumeId: deletedVariant.volumeId,
                            status: 'Active'
                        }
                    });
                    if (!activeVariant) {
                        activeVariant = await ProductVariant.findOne({
                            where: {
                                productId: deletedVariant.productId,
                                status: 'Active'
                            }
                        });
                    }
                    if (activeVariant) {
                        variant = activeVariant;
                        cartItem.variantId = activeVariant.id;
                        await cartItem.save();
                    }
                }
            }
            const bUPP = variant ? Number(variant.baseUnitsPerPack || 1) : 1;
            const deductionRequired = variant && variant.sellingVolume 
                ? proposedQty * Number(variant.sellingVolume) * bUPP
                : proposedQty * bUPP;

            const availableStock = await getAvailableStock(cartItem.productId, userId);
            if (deductionRequired > availableStock) {
                return sendErrorResponse(
                    res, 
                    HTTP_STATUS.BAD_REQUEST, 
                    `Insufficient stock. Available stock: ${availableStock} base units. Your request requires: ${deductionRequired} base units.`
                );
            }
        }

        if (proposedQty <= 0) {
            await cartItem.destroy();
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from cart");
        }

        cartItem.quantity = proposedQty;
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
