import MainCategory from '../../models/superadmin-models/MainCategory.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

export const createMainCategory = async (req, res, next) => {
    try {
        const { image, title, description, status } = req.body;
        // title is expected to be an object: { en: "Name", gu: "નામ" }

        const mainCategory = await MainCategory.create({ image, title, description, status });
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
            const categories = await MainCategory.findAll({ where: whereClause, order: [['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Main Categories fetched successfully.", { categories, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await MainCategory.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
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
