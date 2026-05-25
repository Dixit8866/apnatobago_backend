import { Cart, Product, ProductVariant, ProductPricing, Volume, Wishlist, InventoryStock } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { Op } from 'sequelize';

// Helper to get available stock of a product across ALL godowns.
// Cart availability check sums stock from all godowns so the user
// can add to cart as long as stock exists anywhere in the system.
// Godown-specific deduction still happens correctly at order placement time.
const getAvailableStock = async (productId) => {
    const totalStock = await InventoryStock.sum('totalBaseUnits', {
        where: {
            productId,
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
        const page = req.query.page ? parseInt(req.query.page) : null;
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        const paginate = req.query.paginate === 'true';

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
                    attributes: ['id', 'volume', 'extra', 'image', 'baseUnitLabel', 'innerUnitLabel', 'purchasePrice', 'sellingVolume', 'baseUnitsPerPack'],
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
                        attributes: ['id', 'volume', 'extra', 'image', 'baseUnitLabel', 'innerUnitLabel', 'purchasePrice', 'sellingVolume', 'baseUnitsPerPack'],
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

        // Consolidate/merge duplicate items with the same productId and variantId
        const consolidatedMap = new Map();
        const itemsToDelete = [];
        let needsRefetch = false;

        for (const item of cartItemsRaw) {
            if (!item.productId || !item.variantId) continue;
            const key = `${item.productId}_${item.variantId}`;
            if (consolidatedMap.has(key)) {
                const existingItem = consolidatedMap.get(key);
                existingItem.quantity = Number(existingItem.quantity) + Number(item.quantity);
                itemsToDelete.push(item.id);
                needsRefetch = true;
            } else {
                consolidatedMap.set(key, item);
            }
        }

        if (needsRefetch) {
            // Delete duplicates from DB
            await Cart.destroy({
                where: {
                    id: itemsToDelete
                }
            });
            // Update the kept items' quantities in the DB
            for (const item of consolidatedMap.values()) {
                await Cart.update(
                    { quantity: item.quantity },
                    { where: { id: item.id } }
                );
            }
            // Re-fetch populated cart to ensure clean data and order
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
                        attributes: ['id', 'volume', 'extra', 'image', 'baseUnitLabel', 'innerUnitLabel', 'purchasePrice', 'sellingVolume', 'baseUnitsPerPack'],
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

            const unitPrice = rawPrice;
            const unitMrp = rawMrp;

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
                extra: variant.extra,
                extraName: variant.extra,
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

        // Slice items based on page and limit ONLY if paginate is set to true
        let paginatedItems = formattedItems;
        if (paginate && page !== null && limit !== null) {
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            paginatedItems = formattedItems.slice(startIndex, endIndex);
        }

        // Simple delivery logic (can be adjusted based on requirements)
        const deliveryCharges = 0;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart fetched successfully", {
            items: paginatedItems,
            billDetails: {
                totalCount: formattedItems.length,
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

        console.log(`\n[DEBUG addToCart] ───────────────────────────────`);
        console.log(`[DEBUG addToCart] userId=${userId}`);
        console.log(`[DEBUG addToCart] productId=${productId}`);
        console.log(`[DEBUG addToCart] variantId=${variantId}`);
        console.log(`[DEBUG addToCart] quantity=${quantity}`);

        if (!productId || !variantId || quantity === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide product, variant and quantity");
        }

        // Fetch variant to calculate base units required
        let variant = await ProductVariant.findByPk(variantId);
        let resolvedVariantId = variantId;
        if (!variant) {
            console.log(`[DEBUG addToCart] Variant not found (active), checking soft-deleted...`);
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
                    console.log(`[DEBUG addToCart] Resolved to active variant: ${resolvedVariantId}`);
                }
            }
        }

        if (!variant) {
            console.log(`[DEBUG addToCart] ERROR: No variant found at all`);
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found");
        }

        console.log(`[DEBUG addToCart] variant.id=${variant.id}`);
        console.log(`[DEBUG addToCart] variant.volume=${variant.volume}`);
        console.log(`[DEBUG addToCart] variant.baseUnitsPerPack=${variant.baseUnitsPerPack}`);
        console.log(`[DEBUG addToCart] variant.sellingVolume=${variant.sellingVolume}`);
        console.log(`[DEBUG addToCart] variant.status=${variant.status}`);

        const bUPP = Number(variant.baseUnitsPerPack || 1);
        const qtyToAdd = Number(quantity);

        // Check if item already exists in cart (using findAll to handle potential duplicate rows)
        let cartItems = await Cart.findAll({
            where: { userId, productId, variantId: resolvedVariantId }
        });

        let cartItem = null;
        if (cartItems.length > 0) {
            cartItem = cartItems[0];
            if (cartItems.length > 1) {
                // Merge all duplicate records' quantities into the first one
                let totalQty = 0;
                for (const item of cartItems) {
                    totalQty += Number(item.quantity);
                }
                cartItem.quantity = totalQty;
                await cartItem.save();

                // Delete the redundant duplicate rows from DB
                const duplicateIds = cartItems.slice(1).map(item => item.id);
                await Cart.destroy({ where: { id: duplicateIds } });
            }
        }

        const currentCartQty = cartItem ? Number(cartItem.quantity) : 0;
        const totalProposedQty = currentCartQty + qtyToAdd;

        // last aya change karo cho je koi biji product ma aa issues ave to 
        const deductionRequired = totalProposedQty * bUPP;

        // Check stock first — sum across ALL godowns
        const availableStock = await getAvailableStock(productId);

        console.log(`[DEBUG addToCart] bUPP=${bUPP}`);
        console.log(`[DEBUG addToCart] currentCartQty=${currentCartQty}`);
        console.log(`[DEBUG addToCart] totalProposedQty=${totalProposedQty}`);
        console.log(`[DEBUG addToCart] sellingVolume=${variant.sellingVolume}`);
        console.log(`[DEBUG addToCart] deductionRequired=${deductionRequired}`);
        console.log(`[DEBUG addToCart] availableStock (all godowns)=${availableStock}`);
        console.log(`[DEBUG addToCart] PASS? ${deductionRequired} <= ${availableStock} = ${deductionRequired <= availableStock}`);

        if (deductionRequired > availableStock) {
            console.log(`[DEBUG addToCart] BLOCKED: deductionRequired(${deductionRequired}) > availableStock(${availableStock})`);
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

        console.log(`[DEBUG addToCart] SUCCESS — cart updated`);
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
            const deductionRequired = proposedQty * bUPP;

            const availableStock = await getAvailableStock(cartItem.productId);
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
