import SubCategory from '../../models/superadmin-models/SubCategory.js';
import MainCategory from '../../models/superadmin-models/MainCategory.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

// -------------------------------------------------------------
// CREATE SUB CATEGORY
// -------------------------------------------------------------
export const createSubCategory = async (req, res, next) => {
    try {
        const { mainCategoryId, image, title, description, status } = req.body;

        if (!mainCategoryId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "mainCategoryId is required");
        if (!title || Object.keys(title).length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Title is required in at least one language.");
        }

        // Get max position for auto-increment
        const maxPos = await SubCategory.max('position') || 0;
        const newCategory = await SubCategory.create({
            mainCategoryId,
            image,
            title,
            description,
            status,
            position: maxPos + 1
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Sub Category created successfully", newCategory);
    } catch (error) {
        next(error);
    }
};

// -------------------------------------------------------------
// GET ALL SUB CATEGORIES (with standard pagination helper and MainCategory join)
// -------------------------------------------------------------
export const getSubCategories = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        // Base search filter (only text search, no status overrides for counts)
        const searchWhere = search
            ? { title: { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }
            : {};

        const whereWithSearch = { ...searchWhere };

        if (status) {
            whereWithSearch.status = status;
        } else {
            whereWithSearch.status = { [Op.ne]: 'Deleted' }; // Hide deleted from 'All' grid view
        }

        const includeMainCategory = {
            model: MainCategory,
            as: 'mainCategory',
            attributes: ['id', 'title']
        };

        // Parallel status counts (search-aware, not status-filtered)
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            SubCategory.count({ where: { ...searchWhere, status: 'Active' } }),
            SubCategory.count({ where: { ...searchWhere, status: 'Inactive' } }),
            SubCategory.count({ where: { ...searchWhere, status: 'Deleted' } }),
            SubCategory.count({ where: searchWhere }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const categories = await SubCategory.findAll({
                where: whereWithSearch,
                order: [['position', 'ASC'], ['createdAt', 'DESC']],
                include: [includeMainCategory]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Categories fetched successfully", { categories, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit: queryLimit, offset, page: queryPage } = pagination;

        const result = await SubCategory.findAndCountAll({
            where: whereWithSearch,
            limit: queryLimit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']],
            include: [includeMainCategory]
        });

        const responseData = formatPaginatedResponse(result, queryPage, queryLimit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Categories fetched successfully", {
            categories: responseData.data,
            statusCounts,
            pagination: {
                totalRecords: responseData.totalRecords,
                totalPages: responseData.totalPages,
                currentPage: responseData.currentPage,
                limit: queryLimit
            }
        });
    } catch (error) {
        next(error);
    }
};


// -------------------------------------------------------------
// GET SINGLE SUB CATEGORY
// -------------------------------------------------------------
export const getSubCategoryById = async (req, res, next) => {
    try {
        const category = await SubCategory.findByPk(req.params.id, {
            include: [{ model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] }]
        });
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Sub Category not found");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Category fetched successfully", category);
    } catch (error) {
        next(error);
    }
};

// -------------------------------------------------------------
// UPDATE SUB CATEGORY
// -------------------------------------------------------------
export const updateSubCategory = async (req, res, next) => {
    try {
        const { mainCategoryId, image, title, description, status } = req.body;

        const category = await SubCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Sub Category not found");

        if (mainCategoryId) category.mainCategoryId = mainCategoryId;
        if (image !== undefined) category.image = image;
        if (title) category.title = title;
        if (description !== undefined) category.description = description;
        if (status) category.status = status;

        await category.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Category updated successfully", category);
    } catch (error) {
        next(error);
    }
};

// -------------------------------------------------------------
// SOFT DELETE SUB CATEGORY
// -------------------------------------------------------------
export const deleteSubCategory = async (req, res, next) => {
    try {
        const category = await SubCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Sub Category not found");

        category.status = 'Deleted';
        await category.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Category deleted successfully");
    } catch (error) {
        next(error);
    }
};

// ─── REORDER (DRAG & DROP) ───────────────────────────────────────────────────
export const reorderSubCategories = async (req, res, next) => {
    try {
        const { items } = req.body; // [{ id, position }]
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Items array is required.");
        }

        // Update all positions
        for (const item of items) {
            await SubCategory.update(
                { position: item.position },
                { where: { id: item.id } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Categories reordered successfully.");
    } catch (error) {
        next(error);
    }
};

// ─── MOVE TO TOP ─────────────────────────────────────────────────────────────
export const moveSubCategoryToTop = async (req, res, next) => {
    try {
        const { id } = req.params;
        const category = await SubCategory.findByPk(id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Sub Category not found.");

        // Get current min position
        const minPosition = await SubCategory.min('position') || 0;

        // Use transaction for atomic update
        const transaction = await SubCategory.sequelize.transaction();

        try {
            // Shift all categories up by 1 to make room at top
            await SubCategory.increment('position', { by: 1, where: {}, transaction });

            // Set this category to the minimum position
            category.position = minPosition;
            await category.save({ transaction });

            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sub Category moved to top successfully.");
    } catch (error) {
        next(error);
    }
};
