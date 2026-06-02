import { Wishlist, Product, ProductVariant, ProductPricing, Volume, CustomLevel } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

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
                attributes: { exclude: ['isTobaccoProduct', 'position', 'createdAt', 'updatedAt', 'deletedAt'] },
                include: [
                    {
                        model: ProductVariant,
                        as: 'variants',
                        attributes: { exclude: ['purchasePrice', 'productId', 'createdAt', 'updatedAt', 'deletedAt'] },
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

            console.log(wishlistItems, "===wishlistItems")

            const formattedWishlist = wishlistItems.map(item => {
                const itemJson = item.toJSON();
                if (itemJson.product && itemJson.product.variants) {
                    itemJson.product.variants = itemJson.product.variants.map(v => {
                        const volumeName = getVolumeLabel(v.volumeRef, v.volume || '');
                        const baseUnitName = getVolumeLabel(v.baseUnitRef, v.volume || '');
                        const innerUnitName = getVolumeLabel(v.innerUnitRef, v.volume || '');
                        if (debug) {
                            console.log('[Wishlist debug] variant=', {
                                variantId: v.id,
                                volume: v.volume,
                                baseUnitLabelRaw: v.baseUnitLabel,
                                innerUnitLabelRaw: v.innerUnitLabel,
                                baseUnitRefName: v.baseUnitRef?.name,
                                innerUnitRefName: v.innerUnitRef?.name,
                                resolvedBaseUnitLabel: baseUnitName,
                                resolvedInnerUnitLabel: innerUnitName
                            });
                        }
                        return {
                            ...v,
                            volumeLabel: volumeName,
                            baseUnitLabel: baseUnitName,
                            innerUnitLabel: innerUnitName,
                            extra: v.extra || '',
                            extraName: v.extra || '',
                            image: v.image || itemJson.product.thumbnail,
                            thumbnail: v.image || itemJson.product.thumbnail
                        };
                    });
                }
                return itemJson;
            });

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
                if (itemJson.product && itemJson.product.variants) {
                    itemJson.product.variants = itemJson.product.variants.map(v => {
                        const volumeName = getVolumeLabel(v.volumeRef, v.volume || '');
                        const baseUnitName = getVolumeLabel(v.baseUnitRef, v.volume || '');
                        const innerUnitName = getVolumeLabel(v.innerUnitRef, v.volume || '');
                        if (debug) {
                            console.log('[Wishlist debug] variant=', {
                                variantId: v.id,
                                volume: v.volume,
                                baseUnitLabelRaw: v.baseUnitLabel,
                                innerUnitLabelRaw: v.innerUnitLabel,
                                baseUnitRefName: v.baseUnitRef?.name,
                                innerUnitRefName: v.innerUnitRef?.name,
                                resolvedBaseUnitLabel: baseUnitName,
                                resolvedInnerUnitLabel: innerUnitName
                            });
                        }

                        return {
                            ...v,
                            volumeLabel: volumeName,
                            baseUnitLabel: baseUnitName,
                            innerUnitLabel: innerUnitName,
                            extra: v.extra || '',
                            extraName: v.extra || '',
                            image: v.image || itemJson.product.thumbnail,
                            thumbnail: v.image || itemJson.product.thumbnail
                        };
                    });
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
