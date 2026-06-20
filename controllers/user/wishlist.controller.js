import { Wishlist, Product, ProductVariant, ProductPricing, Volume, CustomLevel } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import sequelize from '../../config/db.js';

const getVolumeLabel = (volumeRef, fallback = '') => {
    if (!volumeRef || !volumeRef.name) return fallback;
    const name = volumeRef.name;
    if (typeof name === 'string') return name;
    if (name.en) return name.en;
    const stringValues = Object.values(name).filter(v => typeof v === 'string');
    return stringValues.length ? stringValues[0] : fallback;
};

/**
 * @desc    Get current user's wishlist with populated data
 * @route   GET /api/user/wishlist
 * @access  Private (User)
 */
export const getWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const userLevel = req.user.applevel || null;
        const pricingWhere = userLevel ? { customLevelId: userLevel } : {};
        const { paginate, page: queryPage, limit: queryLimit } = req.query;
        const debug = req.query.debug === 'true';

        console.log(userId, userLevel, pricingWhere);
        console.log(paginate, queryPage, queryLimit);
        if (debug) {
            console.log('[Wishlist debug] request query=', req.query);
        }

        const include = [
            {
                model: Product,
                as: 'product',
                where: req.user && !req.user.showtabacco ? { isTobaccoProduct: false } : {},
                attributes: { exclude: ['isTobaccoProduct', 'position', 'createdAt', 'updatedAt', 'deletedAt', 'productDescription'] },
                include: [
                    {
                        model: ProductVariant,
                        as: 'variants',
                        attributes: {
                            exclude: ['purchasePrice', 'productId', 'createdAt', 'updatedAt', 'deletedAt', 'variantInfo'],
                            include: [
                                [
                                    sequelize.literal(`(
                                        SELECT COALESCE(SUM("stock"."totalBaseUnits"), 0)
                                        FROM "inventory_stocks" AS "stock"
                                        WHERE "stock"."variantId" = "product->variants"."id"
                                          AND "stock"."status" = 'Active'
                                          AND "stock"."deletedAt" IS NULL
                                    )`),
                                    'totalStock'
                                ]
                            ]
                        },
                        include: [
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                            {
                                model: ProductPricing,
                                as: 'pricings',
                                where: pricingWhere,
                                required: false,
                                attributes: { exclude: ['purchasePrice', 'variantId', 'createdAt', 'updatedAt', 'deletedAt', 'customLevelId'] },
                                include: [{ model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] }],
                                order: [['minQty', 'ASC']]
                            }
                        ]
                    }
                ]
            }
        ];

        const order = [
            ['createdAt', 'DESC'],
            [{ model: Product, as: 'product' }, { model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC'],
            [{ model: Product, as: 'product' }, { model: ProductVariant, as: 'variants' }, { model: ProductPricing, as: 'pricings' }, 'minQty', 'ASC']
        ];

        // Backward compatibility: if page & limit are not provided (old app), return all data
        const shouldPaginate = (queryPage || queryLimit) && paginate !== 'false';

        if (!shouldPaginate) {
            const wishlistItems = await Wishlist.findAll({
                where: { userId },
                include,
                order
            });

            const formattedWishlist = wishlistItems.map(item => {
                const itemJson = item.toJSON();
                if (itemJson.product) {
                    // Flatten product.name from multilingual Map to String (Flutter type safety)
                    if (itemJson.product.name && typeof itemJson.product.name === 'object') {
                        itemJson.product.name = itemJson.product.name.en || itemJson.product.name.gu || itemJson.product.name.hi || Object.values(itemJson.product.name)[0] || '';
                    }

                    let outOfStock = true;
                    if (itemJson.product.variants && itemJson.product.variants.length > 0) {
                        const hasAvailableStock = itemJson.product.variants.some(v => (parseFloat(v.totalStock) || 0) > 0);
                        outOfStock = !hasAvailableStock;
                    }
                    itemJson.product.outOfStock = outOfStock;

                    if (itemJson.product.variants) {
                        itemJson.product.variants = itemJson.product.variants.filter(v => {
                            const totalStock = parseFloat(v.totalStock) || 0;
                            const hasExtra = v.extra && v.extra.toString().trim() !== '';
                            if (hasExtra) {
                                return totalStock > 0;
                            }
                            return true;
                        });

                        itemJson.product.variants = itemJson.product.variants.map(v => {
                            // Flatten volumeRef.name to string
                            if (v.volumeRef && v.volumeRef.name && typeof v.volumeRef.name === 'object') {
                                v.volumeRef = { ...v.volumeRef, name: v.volumeRef.name.en || v.volumeRef.name.gu || Object.values(v.volumeRef.name)[0] || '' };
                            }
                            // Flatten baseUnitRef.name to string
                            if (v.baseUnitRef && v.baseUnitRef.name && typeof v.baseUnitRef.name === 'object') {
                                const baseLabel = v.baseUnitRef.name.en || v.baseUnitRef.name.gu || Object.values(v.baseUnitRef.name)[0] || '';
                                v.baseUnitRef = { ...v.baseUnitRef, name: baseLabel };
                                v.baseUnitLabel = baseLabel || v.baseUnitLabel;
                            }
                            // Flatten innerUnitRef.name to string
                            if (v.innerUnitRef && v.innerUnitRef.name && typeof v.innerUnitRef.name === 'object') {
                                const innerLabel = v.innerUnitRef.name.en || v.innerUnitRef.name.gu || Object.values(v.innerUnitRef.name)[0] || '';
                                v.innerUnitRef = { ...v.innerUnitRef, name: innerLabel };
                                v.innerUnitLabel = innerLabel || v.innerUnitLabel;
                            }
                            // Flatten customLevel.name in pricings
                            if (v.pricings && Array.isArray(v.pricings)) {
                                v.pricings = v.pricings.map(p => {
                                    if (p.customLevel && p.customLevel.name && typeof p.customLevel.name === 'object') {
                                        p.customLevel = { ...p.customLevel, name: p.customLevel.name.en || p.customLevel.name.gu || Object.values(p.customLevel.name)[0] || '' };
                                    }
                                    return p;
                                });
                            }
                            v.extraName = v.extra || '';
                            return v;
                        });
                    }
                }
                return itemJson;
            });

            console.log(formattedWishlist,"====formattedWishlist")

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Wishlist fetched successfully", formattedWishlist);
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Wishlist.findAndCountAll({
            where: { userId },
            include,
            limit,
            offset,
            order,
            distinct: true
        });

        const formattedResult = formatPaginatedResponse(result, page, limit);
        console.log(formattedResult, "===formattedResult")
        if (formattedResult.data) {
            formattedResult.data = formattedResult.data.map(item => {
                const itemJson = item.toJSON ? item.toJSON() : item;
                if (itemJson.product) {
                    // Flatten product.name from multilingual Map to String (Flutter type safety)
                    if (itemJson.product.name && typeof itemJson.product.name === 'object') {
                        itemJson.product.name = itemJson.product.name.en || itemJson.product.name.gu || itemJson.product.name.hi || Object.values(itemJson.product.name)[0] || '';
                    }

                    let outOfStock = true;
                    if (itemJson.product.variants && itemJson.product.variants.length > 0) {
                        const hasAvailableStock = itemJson.product.variants.some(v => (parseFloat(v.totalStock) || 0) > 0);
                        outOfStock = !hasAvailableStock;
                    }
                    itemJson.product.outOfStock = outOfStock;

                    if (itemJson.product.variants) {
                        itemJson.product.variants = itemJson.product.variants.filter(v => {
                            const totalStock = parseFloat(v.totalStock) || 0;
                            const hasExtra = v.extra && v.extra.toString().trim() !== '';
                            if (hasExtra) {
                                return totalStock > 0;
                            }
                            return true;
                        });

                        itemJson.product.variants = itemJson.product.variants.map(v => {
                            // Flatten volumeRef.name to string
                            if (v.volumeRef && v.volumeRef.name && typeof v.volumeRef.name === 'object') {
                                v.volumeRef = { ...v.volumeRef, name: v.volumeRef.name.en || v.volumeRef.name.gu || Object.values(v.volumeRef.name)[0] || '' };
                            }
                            // Flatten baseUnitRef.name to string
                            if (v.baseUnitRef && v.baseUnitRef.name && typeof v.baseUnitRef.name === 'object') {
                                const baseLabel = v.baseUnitRef.name.en || v.baseUnitRef.name.gu || Object.values(v.baseUnitRef.name)[0] || '';
                                v.baseUnitRef = { ...v.baseUnitRef, name: baseLabel };
                                v.baseUnitLabel = baseLabel || v.baseUnitLabel;
                            }
                            // Flatten innerUnitRef.name to string
                            if (v.innerUnitRef && v.innerUnitRef.name && typeof v.innerUnitRef.name === 'object') {
                                const innerLabel = v.innerUnitRef.name.en || v.innerUnitRef.name.gu || Object.values(v.innerUnitRef.name)[0] || '';
                                v.innerUnitRef = { ...v.innerUnitRef, name: innerLabel };
                                v.innerUnitLabel = innerLabel || v.innerUnitLabel;
                            }
                            // Flatten customLevel.name in pricings
                            if (v.pricings && Array.isArray(v.pricings)) {
                                v.pricings = v.pricings.map(p => {
                                    if (p.customLevel && p.customLevel.name && typeof p.customLevel.name === 'object') {
                                        p.customLevel = { ...p.customLevel, name: p.customLevel.name.en || p.customLevel.name.gu || Object.values(p.customLevel.name)[0] || '' };
                                    }
                                    return p;
                                });
                            }
                            v.extraName = v.extra || '';
                            return v;
                        });
                    }
                }
                return itemJson;
            });
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Wishlist fetched successfully", formattedResult);
    } catch (error) {
        logger.error(`Error in getWishlist: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Add product to wishlist (findOrCreate)
 * @route   POST /api/user/wishlist
 * @access  Private (User)
 */
export const addToWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const { productId } = req.body;

        if (!productId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide productId");
        }

        const [item, created] = await Wishlist.findOrCreate({
            where: { userId, productId }
        });

        if (!created) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Product already in wishlist", item);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Product added to wishlist", item);
    } catch (error) {
        logger.error(`Error in addToWishlist: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Remove product from wishlist (by ID or ProductID)
 * @route   DELETE /api/user/wishlist/:id
 * @access  Private (User)
 */
export const removeFromWishlist = async (req, res) => {
    try {
        const userId = req.user.id;
        const id = req.params.id || req.query.id;
        const productId = req.query.productId;

        let whereClause = { userId };

        if (id && id !== 'undefined') {
            whereClause.id = id;
        } else if (productId) {
            whereClause.productId = productId;
        } else {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide wishlist ID or productId");
        }

        const deleted = await Wishlist.destroy({
            where: whereClause
        });

        if (!deleted) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Wishlist item not found");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Product removed from wishlist");
    } catch (error) {
        logger.error(`Error in removeFromWishlist: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
