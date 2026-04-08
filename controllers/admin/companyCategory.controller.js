import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';

import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createCompanyCategory = async (req, res, next) => {
    try {
        const { title, description, image, status } = req.body;
        if (!title || typeof title !== 'object' || !Object.values(title).some(v => v?.trim())) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide a title in at least one language.");
        }

        const category = await CompanyCategory.create({
            title,
            description: description || {},
            image: image || null,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Company Category created successfully.", category);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getCompanyCategories = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

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

        // Parallel status counts
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            CompanyCategory.count({ where: { ...searchWhere, status: 'Active' } }),
            CompanyCategory.count({ where: { ...searchWhere, status: 'Inactive' } }),
            CompanyCategory.count({ where: { ...searchWhere, status: 'Deleted' } }),
            CompanyCategory.count({ where: { ...searchWhere } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const categories = await CompanyCategory.findAll({
                where: whereWithSearch,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Categories fetched successfully.", { categories, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await CompanyCategory.findAndCountAll({
            where: whereWithSearch,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
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
        const category = await CompanyCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");
        const result = category.toJSON();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Company Category fetched successfully.", result);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateCompanyCategory = async (req, res, next) => {
    try {
        const { title, description, image, status } = req.body;
        const category = await CompanyCategory.findByPk(req.params.id);
        if (!category) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Company Category not found.");

        await category.update({
            title: title ?? category.title,
            description: description ?? category.description,
            image: image !== undefined ? image : category.image,
            status: status ?? category.status,
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
