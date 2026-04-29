import MainCategory from '../../models/superadmin-models/MainCategory.js';
import SubCategory from '../../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../../models/superadmin-models/ProductPricing.js';
import Volume from '../../models/superadmin-models/Volume.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import Banner from '../../models/superadmin-models/Banner.js';
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
        const categories = await MainCategory.findAll({
            where: { status: 'Active' },
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
                                ${req.user && !req.user.showtabacco ? 'AND product."isTobaccoProduct" = false' : ''}
                        )`),
                        'productCount'
                    ]
                ]
            },
            order: [['position', 'ASC']]
        });
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
        const { mainCategoryId } = req.query;
        const whereClause = { status: 'Active' };
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;

        const categories = await SubCategory.findAll({
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
        });
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
        const { subCategoryId, mainCategoryId } = req.query;
        const whereClause = { status: 'Active' };
        if (subCategoryId) whereClause.subCategoryId = subCategoryId;
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;

        const categories = await CompanyCategory.findAll({
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
        });
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
        const { mainCategoryId, subCategoryId, companyCategoryId } = req.query;
        const user = req.user;

        console.log('[DEBUG] getProducts called');
        console.log('[DEBUG] Query params:', { mainCategoryId, subCategoryId, companyCategoryId });
        console.log('[DEBUG] User:', { id: user?.id, showtabacco: user?.showtabacco });

        const whereClause = { status: 'Active' };
        if (mainCategoryId) whereClause.mainCategoryId = mainCategoryId;
        if (subCategoryId) whereClause.subCategoryId = subCategoryId;
        if (companyCategoryId) whereClause.companyCategoryId = companyCategoryId;

        // If user doesn't have showtabacco permission, only show non-tobacco products
        if (user && !user.showtabacco) {
            whereClause.isTobaccoProduct = false;
        }
        // If user has showtabacco = true, show all products (no isTobaccoProduct filter)

        console.log('[DEBUG] whereClause:', whereClause);

        const products = await Product.findAll({
            where: whereClause,
            order: [['position', 'ASC']],
            attributes: { exclude: ['isTobaccoProduct', 'position', 'createdAt', 'updatedAt', 'deletedAt'] },
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title'] },
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
                            attributes: { exclude: ['purchasePrice', 'variantId', 'createdAt', 'updatedAt', 'deletedAt'] },
                            include: [
                                { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] },
                            ]
                        }
                    ]
                }
            ]
        });

        console.log('[DEBUG] Products found:', products.length);
        console.log('[DEBUG] First product (if any):', products[0] ? { id: products[0].id, name: products[0].name, status: products[0].status, mainCategoryId: products[0].mainCategoryId } : 'No products');

        // Fetch user's wishlist to mark items as wishlisted
        const wishlist = await Wishlist.findAll({
            where: { userId: user.id },
            attributes: ['productId']
        });
        const wishlistedProductIds = new Set(wishlist.map(w => w.productId));

        const mappedProducts = products.map(p => {
            const productJson = p.toJSON();
            productJson.isWishlisted = wishlistedProductIds.has(productJson.id);

            if (productJson.variants) {
                productJson.variants = productJson.variants.map(v => {
                    if (v.baseUnitRef && v.baseUnitRef.name) {
                        v.baseUnitLabel = Object.values(v.baseUnitRef.name)[0] || v.baseUnitLabel;
                    }
                    if (v.innerUnitRef && v.innerUnitRef.name) {
                        v.innerUnitLabel = Object.values(v.innerUnitRef.name)[0] || v.innerUnitLabel;
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
            order: [['position', 'ASC']]
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners fetched successfully", banners);
    } catch (error) {
        logger.error(`[Get Banners Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch banners");
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
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('MainCategory.title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10
        });

        // 2. Search Sub Categories
        const subCategories = await SubCategory.findAll({
            where: {
                status: 'Active',
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('SubCategory.title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10
        });

        // 3. Search Company Categories
        const companyCategories = await CompanyCategory.findAll({
            where: {
                status: 'Active',
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('CompanyCategory.title'), 'text'), { [Op.iLike]: `%${searchLower}%` })
                ]
            },
            limit: 10
        });

        // 4. Search Products
        const productWhere = {
            status: 'Active',
            [Op.or]: [
                sequelize.where(sequelize.cast(sequelize.col('Product.name'), 'text'), { [Op.iLike]: `%${searchLower}%` })
            ]
        };

        if (user && !user.showtabacco) {
            productWhere.isTobaccoProduct = false;
        }

        const products = await Product.findAll({
            where: productWhere,
            limit: 20,
            attributes: { exclude: ['isTobaccoProduct', 'position', 'createdAt', 'updatedAt', 'deletedAt'] },
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title'] },
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
                            attributes: { exclude: ['purchasePrice', 'variantId', 'createdAt', 'updatedAt', 'deletedAt'] },
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

            if (productJson.variants) {
                productJson.variants = productJson.variants.map(v => {
                    if (v.baseUnitRef && v.baseUnitRef.name) {
                        v.baseUnitLabel = Object.values(v.baseUnitRef.name)[0] || v.baseUnitLabel;
                    }
                    if (v.innerUnitRef && v.innerUnitRef.name) {
                        v.innerUnitLabel = Object.values(v.innerUnitRef.name)[0] || v.innerUnitLabel;
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
