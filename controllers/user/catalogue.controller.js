import MainCategory from '../../models/superadmin-models/MainCategory.js';
import SubCategory from '../../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../../models/superadmin-models/ProductPricing.js';
import Volume from '../../models/superadmin-models/Volume.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import Banner from '../../models/superadmin-models/Banner.js';
import Offer from '../../models/superadmin-models/Offer.js';
import Wishlist from '../../models/user/Wishlist.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';

/**
 * @desc    Get all active main categories
 * @route   GET /api/user/main-categories
 * @access  Private (User)
 */
export const getMainCategories = async (req, res) => {
    try {
        const { page, limit } = req.query;
        const showTobacco = req.user ? req.user.showtabacco : false;
        const whereClause = { status: 'Active' };
        if (!showTobacco) {
            whereClause.isTobacco = false;
        }

        const queryOptions = {
            where: whereClause,
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM products AS product
                            WHERE
                                product."mainCategoryId" = "MainCategory".id
                                AND product.status = 'Active'
                                AND product."deletedAt" IS NULL
                                ${!showTobacco ? 'AND product."isTobaccoProduct" = false' : ''}
                        )`),
                        'productCount'
                    ]
                ]
            },
            order: [['position', 'ASC']]
        };

        if (limit) {
            queryOptions.limit = parseInt(limit);
            if (page) {
                queryOptions.offset = (parseInt(page) - 1) * parseInt(limit);
            }
        }

        const categories = await MainCategory.findAll(queryOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Main categories fetched successfully", categories);
    } catch (error) {
        logger.error(`[Get Main Categories Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch main categories");
    }
};

/**
 * @desc    Get sub categories (can filter by mainCategoryId)
 * @route   GET /api/user/sub-categories
 * @access  Private (User)
 */
export const getSubCategories = async (req, res) => {
    try {
        const { mainCategoryId, page, limit } = req.query;
        const whereClause = { status: 'Active' };
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;
        if (req.user && !req.user.showtabacco) {
            whereClause.isTobacco = false;
        }

        const queryOptions = {
            where: whereClause,
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM products AS product
                            WHERE
                                product."subCategoryId" = "SubCategory".id
                                AND product.status = 'Active'
                                AND product."deletedAt" IS NULL
                                ${req.user && !req.user.showtabacco ? 'AND product."isTobaccoProduct" = false' : ''}
                        )`),
                        'productCount'
                    ]
                ]
            },
            order: [['position', 'ASC']]
        };

        if (limit) {
            queryOptions.limit = parseInt(limit);
            if (page) {
                queryOptions.offset = (parseInt(page) - 1) * parseInt(limit);
            }
        }

        const categories = await SubCategory.findAll(queryOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub categories fetched successfully", categories);
    } catch (error) {
        logger.error(`[Get Sub Categories Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch sub categories");
    }
};

/**
 * @desc    Get company categories (can filter by subCategoryId)
 * @route   GET /api/user/company-categories
 * @access  Private (User)
 */
export const getCompanyCategories = async (req, res) => {
    try {
        const { subCategoryId, mainCategoryId, page, limit } = req.query;
        const whereClause = { status: 'Active' };
        if (subCategoryId) whereClause.subCategoryId = subCategoryId;
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;
        if (req.user && !req.user.showtabacco) {
            whereClause.isTobacco = false;
        }

        const queryOptions = {
            where: whereClause,
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM products AS product
                            WHERE
                                product."companyCategoryId" = "CompanyCategory".id
                                AND product.status = 'Active'
                                AND product."deletedAt" IS NULL
                                ${req.user && !req.user.showtabacco ? 'AND product."isTobaccoProduct" = false' : ''}
                        )`),
                        'productCount'
                    ]
                ]
            },
            order: [['position', 'ASC']]
        };

        if (limit) {
            queryOptions.limit = parseInt(limit);
            if (page) {
                queryOptions.offset = (parseInt(page) - 1) * parseInt(limit);
            }
        }

        const categories = await CompanyCategory.findAll(queryOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company categories fetched successfully", categories);
    } catch (error) {
        logger.error(`[Get Company Categories Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch company categories");
    }
};

/**
 * @desc    Get products by category type (Main, Sub, or Company)
 * @route   GET /api/user/products
 * @access  Private (User)
 */
export const getProducts = async (req, res) => {
    try {
        const { mainCategoryId, subCategoryId, companyCategoryId, search, page, limit } = req.query;

        const user = req.user;
        const userLevel = user?.applevel || null;

        const whereClause = { status: 'Active' };
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;
        if (subCategoryId) whereClause.subCategoryId = subCategoryId;
        if (companyCategoryId) whereClause.companyCategoryId = companyCategoryId;
        if (search && String(search).trim()) {
            const searchLower = String(search).trim().toLowerCase();
            whereClause[Op.or] = [
                sequelize.where(sequelize.cast(sequelize.col('name'), 'text'), { [Op.iLike]: `%${searchLower}%` }),
                { serialNumber: { [Op.iLike]: `%${searchLower}%` } },
                sequelize.literal(`EXISTS (SELECT 1 FROM unnest("Product"."keywords") AS k WHERE k ILIKE ${sequelize.escape('%' + searchLower + '%')})`)
            ];
        }

        // If user doesn't have showtabacco permission, only show non-tobacco products
        if (user && !user.showtabacco) {
            whereClause.isTobaccoProduct = false;
        }
        // When a category filter is applied, sort by admin-set position.
        // When browsing all products (no filter), sort by most sold first.
        const isCategoryFiltered = !!(mainCategoryId || subCategoryId || companyCategoryId);

        const orderClause = isCategoryFiltered
            ? [
                ['position', 'ASC'],
                ['id', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, { model: ProductPricing, as: 'pricings' }, 'minQty', 'ASC']
            ]
            : [
                [
                    sequelize.literal(`(
                        SELECT COALESCE(SUM("oi"."quantity"), 0)
                        FROM "order_items" AS "oi"
                        INNER JOIN "orders" AS "o" ON "oi"."orderId" = "o"."id"
                        WHERE "oi"."productId" = "Product".id
                          AND "o"."orderStatus" NOT IN ('Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel')
                          AND "o"."deletedAt" IS NULL
                    )`),
                    'DESC'
                ],
                ['position', 'ASC'],
                ['id', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, { model: ProductPricing, as: 'pricings' }, 'minQty', 'ASC']
            ];

        // Only fetch pricings for the user's assigned level and godown
        const pricingWhere = {
            ...(userLevel && { customLevelId: userLevel }),
            ...(user?.godownId ? {
                [Op.or]: [
                    { godownId: user.godownId },
                    { godownId: null }
                ]
            } : { godownId: null })
        };

        const queryOptions = {
            where: whereClause,
            distinct: true,
            order: orderClause,
            attributes: { exclude: ['isTobaccoProduct', 'createdAt', 'updatedAt', 'deletedAt'] },
            include: [
                {
                    model: MainCategory,
                    as: 'mainCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: SubCategory,
                    as: 'subCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: CompanyCategory,
                    as: 'companyCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: ProductVariant,
                    as: 'variants',
                    attributes: {
                        exclude: ['purchasePrice', 'productId', 'createdAt', 'updatedAt', 'deletedAt'],
                        include: [
                            [
                                sequelize.literal(`(
                                    SELECT COALESCE(SUM("stock"."totalBaseUnits"), 0)
                                    FROM "inventory_stocks" AS "stock"
                                    WHERE "stock"."variantId" = "variants"."id"
                                      AND "stock"."status" = 'Active'
                                      AND "stock"."deletedAt" IS NULL
                                      ${user?.godownId ? `AND "stock"."godownId" = ${sequelize.escape(user.godownId)}` : ''}
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
                            attributes: { exclude: ['purchasePrice', 'variantId', 'createdAt', 'updatedAt', 'deletedAt'] },
                            include: [
                                { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] },
                            ]
                        }
                    ]
                }
            ]
        };

        if (limit) {
            queryOptions.limit = parseInt(limit);
            if (page) {
                queryOptions.offset = (parseInt(page) - 1) * parseInt(limit);
            }
        }

        const products = await Product.findAll(queryOptions);

        // Fetch user's wishlist to mark items as wishlisted
        const wishlist = await Wishlist.findAll({
            where: { userId: user.id },
            attributes: ['productId']
        });
        const wishlistedProductIds = new Set(wishlist.map(w => w.productId));

        const mappedProducts = products.map(p => {
            const productJson = p.toJSON();
            productJson.isWishlisted = wishlistedProductIds.has(productJson.id);

            let outOfStock = true;
            if (productJson.variants && productJson.variants.length > 0) {
                const hasAvailableStock = productJson.variants.some(v => (parseFloat(v.totalStock) || 0) > 0);
                outOfStock = !hasAvailableStock;
            }
            productJson.outOfStock = outOfStock;

            if (productJson.variants) {
                productJson.variants = productJson.variants.filter(v => {
                    const totalStock = parseFloat(v.totalStock) || 0;
                    const hasExtra = v.extra && v.extra.toString().trim() !== '';
                    if (hasExtra) {
                        return totalStock > 0;
                    }
                    return true;
                });

                productJson.variants = productJson.variants.map(v => {
                    if (v.baseUnitRef && v.baseUnitRef.name) {
                        v.baseUnitLabel = Object.values(v.baseUnitRef.name)[0] || v.baseUnitLabel;
                    }
                    if (v.innerUnitRef && v.innerUnitRef.name) {
                        v.innerUnitLabel = Object.values(v.innerUnitRef.name)[0] || v.innerUnitLabel;
                    }
                    v.extraName = v.extra || '';

                    // Prioritize godown-specific pricing over default global pricing (godownId = null)
                    if (v.pricings && Array.isArray(v.pricings) && v.pricings.length > 0) {
                        const pricingMap = new Map();
                        for (const p of v.pricings) {
                            const levelKey = `${p.customLevelId || p.customLevel?.id || 'default'}_${p.minQty}_${p.maxQty}`;
                            // If key doesn't exist or current p has a specific godownId matching user, overwrite
                            if (!pricingMap.has(levelKey) || (p.godownId && String(p.godownId) === String(user?.godownId))) {
                                pricingMap.set(levelKey, p);
                            }
                        }
                        v.pricings = Array.from(pricingMap.values());
                    }

                    return v;
                });
            }
            return productJson;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Products fetched successfully", mappedProducts);
    } catch (error) {
        logger.error(`[Get Products Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch products");
    }
};

/**
 * @desc    Get products by Main Category ID
 * @route   GET /api/user/products/main-category/:id
 * @access  Private (User)
 */
export const getProductsByMainCategory = async (req, res) => {
    req.query.mainCategoryId = req.params.id;
    return getProducts(req, res);
};

/**
 * @desc    Get products by Sub Category ID
 * @route   GET /api/user/products/sub-category/:id
 * @access  Private (User)
 */
export const getProductsBySubCategory = async (req, res) => {
    req.query.subCategoryId = req.params.id;
    return getProducts(req, res);
};

/**
 * @desc    Get products by Company Category ID
 * @route   GET /api/user/products/company-category/:id
 * @access  Private (User)
 */
export const getProductsByCompanyCategory = async (req, res) => {
    req.query.companyCategoryId = req.params.id;
    return getProducts(req, res);
};

/**
 * @desc    Get all active banners
 * @route   GET /api/user/banners
 * @access  Private (User)
 */
export const getBanners = async (req, res) => {
    try {
        const banners = await Banner.findAll({
            where: { status: 'Active' },
            include: [{ model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] }],
            order: [['position', 'ASC']]
        });

        const showTobacco = req.user ? req.user.showtabacco : false;
        if (!showTobacco) {
            // Filter out banners containing tobacco keywords (in JSONB title) to pass Apple App Review safely
            const tobaccoKeywords = [
                'tobacco', 'tobaco', 'cigarette', 'cig', 'smoking', 'bidi', 'gutka', 'paan', 'pan', 'smoke',
                'તમાકુ', 'બીડી', 'સિગારેટ', 'ગુટખા', 'માવો', 'પાન', 'ખૈની'
            ];

            const filteredBanners = banners.filter(banner => {
                const titleStr = JSON.stringify(banner.title || {}).toLowerCase();
                return !tobaccoKeywords.some(keyword => titleStr.includes(keyword));
            });

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners fetched successfully", filteredBanners);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners fetched successfully", banners);
    } catch (error) {
        logger.error(`[Get Banners Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch banners");
    }
};

/**
 * @desc    Get active and currently valid offers
 * @route   GET /api/user/offers
 * @access  Private (User)
 */
export const getOffers = async (req, res) => {
    try {
        const now = new Date();
        const offers = await Offer.findAll({
            where: {
                status: 'Active',
                [Op.and]: [
                    {
                        [Op.or]: [
                            { startDate: null },
                            { startDate: { [Op.lte]: now } }
                        ]
                    },
                    {
                        [Op.or]: [
                            { endDate: null },
                            { endDate: { [Op.gte]: now } }
                        ]
                    }
                ]
            },
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: Product, as: 'product', attributes: ['id', 'name'] }
            ],
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const showTobacco = req.user ? req.user.showtabacco : false;
        if (!showTobacco) {
            const tobaccoKeywords = [
                'tobacco', 'tobaco', 'cigarette', 'cig', 'smoking', 'bidi', 'gutka', 'paan', 'pan', 'smoke',
                'તમાકુ', 'બીડી', 'સિગારેટ', 'ગુટખા', 'માવો', 'પાન', 'ખૈની'
            ];

            const filteredOffers = offers.filter(offer => {
                const nameStr = JSON.stringify(offer.name || {}).toLowerCase();
                const descStr = JSON.stringify(offer.description || {}).toLowerCase();
                return !tobaccoKeywords.some(keyword => nameStr.includes(keyword) || descStr.includes(keyword));
            });

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Offers fetched successfully", filteredOffers);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offers fetched successfully", offers);
    } catch (error) {
        logger.error(`[Get Offers Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch offers");
    }
};
/**
 * @desc    Search catalogue (Products and Categories)
 * @route   GET /api/user/search
 * @access  Private (User)
 */
export const searchCatalogue = async (req, res) => {
    try {
        const { query } = req.query;
        const user = req.user;
        const userLevel = user?.applevel || null;

        if (!query || query.trim() === '') {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Search query is empty", {
                products: [],
                categories: { main: [], sub: [], company: [] }
            });
        }

        const searchLower = query.toLowerCase();

        // 1. Search Main Categories
        const mainCategories = await MainCategory.findAll({
            where: {
                status: 'Active',
                ...(req.user && !req.user.showtabacco ? { isTobacco: false } : {}),
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10,
            order: [['position', 'ASC']]
        });

        // 2. Search Sub Categories
        const subCategories = await SubCategory.findAll({
            where: {
                status: 'Active',
                ...(req.user && !req.user.showtabacco ? { isTobacco: false } : {}),
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10,
            order: [['position', 'ASC']]
        });

        // 3. Search Company Categories
        const companyCategories = await CompanyCategory.findAll({
            where: {
                status: 'Active',
                ...(req.user && !req.user.showtabacco ? { isTobacco: false } : {}),
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10,
            order: [['position', 'ASC']]
        });

        // 4. Search Products
        const productWhere = {
            status: 'Active',
            [Op.or]: [
                sequelize.where(sequelize.cast(sequelize.col('name'), 'text'), { [Op.iLike]: `%${searchLower}%` }),
                { serialNumber: { [Op.iLike]: `%${searchLower}%` } },
                sequelize.literal(`EXISTS (SELECT 1 FROM unnest("Product"."keywords") AS k WHERE k ILIKE ${sequelize.escape('%' + searchLower + '%')})`)
            ]
        };

        if (user && !user.showtabacco) {
            productWhere.isTobaccoProduct = false;
        }



        // Only fetch pricings for the user's assigned level and godown
        const pricingWhere = {
            ...(userLevel && { customLevelId: userLevel }),
            ...(user?.godownId ? {
                [Op.or]: [
                    { godownId: user.godownId },
                    { godownId: null }
                ]
            } : { godownId: null })
        };

        const products = await Product.findAll({
            where: productWhere,
            limit: 20,
            order: [
                [
                    sequelize.literal(`(
                        SELECT COALESCE(SUM("oi"."quantity"), 0)
                        FROM "order_items" AS "oi"
                        INNER JOIN "orders" AS "o" ON "oi"."orderId" = "o"."id"
                        WHERE "oi"."productId" = "Product".id
                          AND "o"."orderStatus" NOT IN ('Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel')
                          AND "o"."deletedAt" IS NULL
                    )`),
                    'DESC'
                ],
                ['position', 'ASC'],
                ['id', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, { model: ProductPricing, as: 'pricings' }, 'minQty', 'ASC']
            ],
            attributes: { exclude: ['isTobaccoProduct', 'createdAt', 'updatedAt', 'deletedAt'] },
            include: [
                {
                    model: MainCategory,
                    as: 'mainCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: SubCategory,
                    as: 'subCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: CompanyCategory,
                    as: 'companyCategory',
                    attributes: ['id', 'title', 'isTobacco'],
                    where: user && !user.showtabacco ? { isTobacco: false } : {}
                },
                {
                    model: ProductVariant,
                    as: 'variants',
                    attributes: {
                        exclude: ['purchasePrice', 'productId', 'createdAt', 'updatedAt', 'deletedAt'],
                        include: [
                            [
                                sequelize.literal(`(
                                    SELECT COALESCE(SUM("stock"."totalBaseUnits"), 0)
                                    FROM "inventory_stocks" AS "stock"
                                    WHERE "stock"."variantId" = "variants"."id"
                                      AND "stock"."status" = 'Active'
                                      AND "stock"."deletedAt" IS NULL
                                      ${user?.godownId ? `AND "stock"."godownId" = ${sequelize.escape(user.godownId)}` : ''}
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
                            include: [
                                { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] },
                            ]
                        }
                    ]
                }
            ]
        });

        // Map wishlist status for products
        const wishlist = await Wishlist.findAll({
            where: { userId: user.id },
            attributes: ['productId']
        });
        const wishlistedProductIds = new Set(wishlist.map(w => w.productId));

        const mappedProducts = products.map(p => {
            const productJson = p.toJSON();
            productJson.isWishlisted = wishlistedProductIds.has(productJson.id);

            let outOfStock = true;
            if (productJson.variants && productJson.variants.length > 0) {
                const hasAvailableStock = productJson.variants.some(v => (parseFloat(v.totalStock) || 0) > 0);
                outOfStock = !hasAvailableStock;
            }
            productJson.outOfStock = outOfStock;

            if (productJson.variants) {
                productJson.variants = productJson.variants.filter(v => {
                    const totalStock = parseFloat(v.totalStock) || 0;
                    const hasExtra = v.extra && v.extra.toString().trim() !== '';
                    if (hasExtra) {
                        return totalStock > 0;
                    }
                    return true;
                });

                productJson.variants = productJson.variants.map(v => {
                    if (v.baseUnitRef && v.baseUnitRef.name) {
                        v.baseUnitLabel = Object.values(v.baseUnitRef.name)[0] || v.baseUnitLabel;
                    }
                    if (v.innerUnitRef && v.innerUnitRef.name) {
                        v.innerUnitLabel = Object.values(v.innerUnitRef.name)[0] || v.innerUnitLabel;
                    }
                    v.extraName = v.extra || '';

                    // Prioritize godown-specific pricing over default global pricing (godownId = null)
                    if (v.pricings && Array.isArray(v.pricings) && v.pricings.length > 0) {
                        const pricingMap = new Map();
                        for (const p of v.pricings) {
                            const levelKey = `${p.customLevelId || p.customLevel?.id || 'default'}_${p.minQty}_${p.maxQty}`;
                            if (!pricingMap.has(levelKey) || (p.godownId && String(p.godownId) === String(user?.godownId))) {
                                pricingMap.set(levelKey, p);
                            }
                        }
                        v.pricings = Array.from(pricingMap.values());
                    }

                    return v;
                });
            }
            return productJson;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Search results fetched successfully", {
            products: mappedProducts,
            categories: {
                main: mainCategories,
                sub: subCategories,
                company: companyCategories
            }
        });
    } catch (error) {
        logger.error(`[Search Catalogue Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to search catalogue");
    }
};
