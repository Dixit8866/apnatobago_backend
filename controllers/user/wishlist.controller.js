import { Wishlist, Product, ProductVariant, ProductPricing, Volume, CustomLevel } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get current user's wishlist with populated data
 * @route   GET /api/user/wishlist
 * @access  Private (User)
 */
export const getWishlist = async (req, res) => {
    try {
        const userLevel = req.user.applevel || null;
        const pricingWhere = userLevel ? { customLevelId: userLevel } : {};

        const wishlistItems = await Wishlist.findAll({
            where: { userId },
            include: [
                {
                    model: Product,
                    as: 'product',
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
                                    include: [{ model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] }]
                                }
                            ]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        const formattedWishlist = wishlistItems.map(item => {
            const itemJson = item.toJSON();
            if (itemJson.product && itemJson.product.variants) {
                itemJson.product.variants = itemJson.product.variants.map(v => {
                    const baseUnitName = v.baseUnitRef?.name ? (Object.values(v.baseUnitRef.name)[0]) : null;
                    const innerUnitName = v.innerUnitRef?.name ? (Object.values(v.innerUnitRef.name)[0]) : null;
                    
                    return {
                        ...v,
                        baseUnitLabel: baseUnitName || v.baseUnitLabel,
                        innerUnitLabel: innerUnitName || v.innerUnitLabel,
                        image: v.image || itemJson.product.thumbnail,
                        thumbnail: v.image || itemJson.product.thumbnail
                    };
                });
            }
            return itemJson;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Wishlist fetched successfully", formattedWishlist);
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
