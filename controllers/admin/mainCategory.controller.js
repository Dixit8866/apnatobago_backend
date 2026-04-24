import MainCategory from '../../models/superadmin-models/MainCategory.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

export const createMainCategory = async (req, res, next) => {
    try {
        const { image, title, description, status } = req.body;
        // title is expected to be an object: { en: "Name", gu: "નામ" }

        // Get max position for auto-increment
        const maxPos = await MainCategory.max('position') || 0;
        const mainCategory = await MainCategory.create({
            image, title, description, status,
            position: maxPos + 1
        });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Main Category created successfully.", mainCategory);
    } catch (error) {
        next(error);
    }
};

export const getMainCategories = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};

        // Search-only where (strictly for text search filters, no status overrides)
        let searchOnlyWhere = {};

        if (search) {
            const searchFilter = { [Op.or]: [{ "title": { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }] };
            whereClause = { ...whereClause, ...searchFilter };
            searchOnlyWhere = { ...searchFilter };
        }

        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' }; // Hide deleted from 'All' tab
        }

        const pagination = getPaginationOptions(req.query);

        // Parallel status count queries
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            MainCategory.count({ where: { ...searchOnlyWhere, status: 'Active' } }),
            MainCategory.count({ where: { ...searchOnlyWhere, status: 'Inactive' } }),
            MainCategory.count({ where: { ...searchOnlyWhere, status: 'Deleted' } }),
            MainCategory.count({ where: { ...searchOnlyWhere } }) // This now allows ANY status for the ALL count
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const categories = await MainCategory.findAll({ 
                where: whereClause, 
                attributes: {
                    include: [
                        [
                            sequelize.literal(`(
                                SELECT COUNT(*)
                                FROM products AS product
                                WHERE
                                    product."mainCategoryId" = "MainCategory".id
                                    AND product.status != 'Deleted'
                                    AND product."deletedAt" IS NULL
                            )`),
                            'productCount'
                        ]
                    ]
                },
                order: [['position', 'ASC'], ['createdAt', 'DESC']] 
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Categories fetched successfully.", { categories, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await MainCategory.findAndCountAll({
            where: whereClause,
            attributes: {
                include: [
                    [
                        sequelize.literal(`(
                            SELECT COUNT(*)
                            FROM products AS product
                            WHERE
                                product."mainCategoryId" = "MainCategory".id
                                AND product.status != 'Deleted'
                                AND product."deletedAt" IS NULL
                        )`),
                        'productCount'
                    ]
                ]
            },
            limit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Categories fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

export const getMainCategoryById = async (req, res, next) => {
    try {
        const category = await MainCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Main Category not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Category fetched successfully.", category);
    } catch (error) {
        next(error);
    }
};

export const updateMainCategory = async (req, res, next) => {
    try {
        const { image, title, description, status } = req.body;
        const category = await MainCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Main Category not found.");

        await category.update({ image, title, description, status });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Category updated successfully.", category);
    } catch (error) {
        next(error);
    }
};

export const deleteMainCategory = async (req, res, next) => {
    try {
        const category = await MainCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Main Category not found.");

        category.status = 'Deleted';
        await category.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Category deleted successfully.");
    } catch (error) {
        next(error);
    }
};

// ─── REORDER (DRAG & DROP) ───────────────────────────────────────────────────
export const reorderMainCategories = async (req, res, next) => {
    try {
        const { items } = req.body; // [{ id, position }]
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Items array is required.");
        }

        // Update all positions in a transaction
        for (const item of items) {
            await MainCategory.update(
                { position: item.position },
                { where: { id: item.id } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Categories reordered successfully.");
    } catch (error) {
        next(error);
    }
};

// ─── MOVE TO TOP ─────────────────────────────────────────────────────────────
export const moveMainCategoryToTop = async (req, res, next) => {
    try {
        const { id } = req.params;
        const category = await MainCategory.findByPk(id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Main Category not found.");

        // Get current min position
        const minPosition = await MainCategory.min('position') || 0;

        // Use transaction for atomic update
        const transaction = await MainCategory.sequelize.transaction();

        try {
            // Shift all categories up by 1 to make room at top
            await MainCategory.increment('position', { by: 1, where: {}, transaction });

            // Set this category to the minimum position
            category.position = minPosition;
            await category.save({ transaction });

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Category moved to top successfully.");
    } catch (error) {
        next(error);
    }
};
