import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';
import MainCategory from '../../models/superadmin-models/MainCategory.js';
import SubCategory from '../../models/superadmin-models/SubCategory.js';

import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createCompanyCategory = async (req, res, next) => {
    try {
        const { title, description, image, status, mainCategoryId, subCategoryId, isTobacco } = req.body;
        if (!title || typeof title !== 'object' || !Object.values(title).some(v => v?.trim())) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide a title in at least one language.");
        }

        const category = await CompanyCategory.create({
            title,
            description: description || {},
            image: image || null,
            status: status || 'Active',
            mainCategoryId: mainCategoryId || null,
            subCategoryId: subCategoryId || null,
            isTobacco: isTobacco || false
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Company Category created successfully.", category);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getCompanyCategories = async (req, res, next) => {
    try {
        const { search = '', status, mainCategoryId } = req.query;

        // Search-only where for accurate tab counts (no status filter)
        const searchWhere = search
            ? { title: { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }
            : {};

        const whereWithSearch = { ...searchWhere };
        if (status) {
            whereWithSearch.status = status;
        } else {
            whereWithSearch.status = { [Op.ne]: 'Deleted' }; // Hide deleted from All tab
        }

        if (mainCategoryId) {
            whereWithSearch.mainCategoryId = mainCategoryId;
        }

        // Parallel status counts
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            CompanyCategory.count({ where: { ...searchWhere, status: 'Active' } }),
            CompanyCategory.count({ where: { ...searchWhere, status: 'Inactive' } }),
            CompanyCategory.count({ where: { ...searchWhere, status: 'Deleted' } }),
            CompanyCategory.count({ where: { ...searchWhere } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        const include = [
            { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
            { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
        ];

        if (req.query.paginate === 'false') {
            const categories = await CompanyCategory.findAll({
                where: whereWithSearch,
                attributes: {
                    include: [
                        [
                            sequelize.literal(`(
                                SELECT COUNT(*)
                                FROM products AS product
                                WHERE
                                    product."companyCategoryId" = "CompanyCategory".id
                                    AND product.status != 'Deleted'
                                    AND product."deletedAt" IS NULL
                            )`),
                            'productCount'
                        ]
                    ]
                },
                include,
                order: [['position', 'ASC'], ['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Categories fetched successfully.", { categories, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await CompanyCategory.findAndCountAll({
            where: whereWithSearch,
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM products AS product
                            WHERE
                                product."companyCategoryId" = "CompanyCategory".id
                                AND product.status != 'Deleted'
                                AND product."deletedAt" IS NULL
                        )`),
                        'productCount'
                    ]
                ]
            },
            include,
            limit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Categories fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getCompanyCategoryById = async (req, res, next) => {
    try {
        const category = await CompanyCategory.findByPk(req.params.id, {
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
            ]
        });
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");
        const result = category.toJSON();

        // DEBUG: Log what we send back to frontend
        console.log('[GET_BY_ID] Company Category fetched:', {
            id:             result.id,
            mainCategoryId: result.mainCategoryId,
            subCategoryId:  result.subCategoryId,
            mainCategory:   result.mainCategory,
            subCategory:    result.subCategory,
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Category fetched successfully.", result);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateCompanyCategory = async (req, res, next) => {
    try {
        const { title, description, image, status, mainCategoryId, subCategoryId, isTobacco } = req.body;
        const category = await CompanyCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");

        await category.update({
            title: title ?? category.title,
            description: description ?? category.description,
            image: image !== undefined ? image : category.image,
            status: status ?? category.status,
            mainCategoryId: mainCategoryId !== undefined ? mainCategoryId : category.mainCategoryId,
            subCategoryId: subCategoryId !== undefined ? subCategoryId : category.subCategoryId,
            isTobacco: isTobacco !== undefined ? isTobacco : category.isTobacco,
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Category updated successfully.", category);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE (status = 'Deleted') ────────────────────────────────────────
export const deleteCompanyCategory = async (req, res, next) => {
    try {
        const category = await CompanyCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");

        category.status = 'Deleted';
        await category.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Category deleted successfully.");
    } catch (error) {
        next(error);
    }
};

// ─── REORDER (DRAG & DROP) ───────────────────────────────────────────────────
export const reorderCompanyCategories = async (req, res, next) => {
    try {
        const { items } = req.body; // [{ id, position }]
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid items array.");
        }

        // Update positions in parallel
        await Promise.all(
            items.map(async (item) => {
                if (!item.id || typeof item.position !== 'number') return;
                await CompanyCategory.update(
                    { position: item.position },
                    { where: { id: item.id } }
                );
            })
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Categories reordered successfully.");
    } catch (error) {
        next(error);
    }
};

// ─── MOVE TO TOP ─────────────────────────────────────────────────────────────
export const moveCompanyCategoryToTop = async (req, res, next) => {
    try {
        const { id } = req.params;
        
        // Get all active categories ordered by position
        const categories = await CompanyCategory.findAll({
            where: { status: { [Op.ne]: 'Deleted' } },
            order: [['position', 'ASC']]
        });
        
        // Find the target category
        const targetIndex = categories.findIndex(c => c.id === id);
        if (targetIndex === -1) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");
        }
        
        // Remove target from current position and insert at beginning
        const [target] = categories.splice(targetIndex, 1);
        categories.unshift(target);
        
        // Update all positions sequentially
        await Promise.all(
            categories.map(async (cat, index) => {
                await CompanyCategory.update(
                    { position: index },
                    { where: { id: cat.id } }
                );
            })
        );
        
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Category moved to top successfully.");
    } catch (error) {
        next(error);
    }
};
