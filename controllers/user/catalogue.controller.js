import MainCategory from '../../models/superadmin-models/MainCategory.js';
import SubCategory from '../../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';
import Product from '../../models/superadmin-models/Product.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get all active main categories
 * @route   GET /api/user/main-categories
 * @access  Private (User)
 */
export const getMainCategories = async (req, res) => {
    try {
        const categories = await MainCategory.findAll({
            where: { status: 'Active' },
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
            order: [['position', 'ASC']]
        });

        console.log('[DEBUG] Products found:', products.length);
        console.log('[DEBUG] First product (if any):', products[0] ? { id: products[0].id, name: products[0].name, status: products[0].status, mainCategoryId: products[0].mainCategoryId } : 'No products');

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Products fetched successfully", products);
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
