import { Op } from 'sequelize';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';

export const createCustomLevel = async (req, res, next) => {
    try {
        const { name, status } = req.body;

        if (!name || !name.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Level name is required.');
        }

        const customLevel = await CustomLevel.create({
            name: name.trim(),
            status: status || 'Active',
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Custom Level created successfully.', customLevel);
    } catch (error) {
        next(error);
    }
};

export const getCustomLevels = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        const searchWhere = search
            ? { name: { [Op.iLike]: `%${search}%` } }
            : {};

        const whereWithFilters = { ...searchWhere };
        if (status) {
            whereWithFilters.status = status;
        } else {
            whereWithFilters.status = { [Op.ne]: 'Deleted' };
        }

        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            CustomLevel.count({ where: { ...searchWhere, status: 'Active' } }),
            CustomLevel.count({ where: { ...searchWhere, status: 'Inactive' } }),
            CustomLevel.count({ where: { ...searchWhere, status: 'Deleted' } }),
            CustomLevel.count({ where: searchWhere }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const customLevels = await CustomLevel.findAll({
                where: whereWithFilters,
                order: [['createdAt', 'DESC']],
            });

            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Custom Levels fetched successfully.', {
                customLevels,
                statusCounts,
            });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await CustomLevel.findAndCountAll({
            where: whereWithFilters,
            limit,
            offset,
            order: [['createdAt', 'DESC']],
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Custom Levels fetched successfully.', {
            customLevels: responseData.data,
            statusCounts,
            pagination: {
                totalRecords: responseData.totalRecords,
                totalPages: responseData.totalPages,
                currentPage: responseData.currentPage,
                limit,
            },
        });
    } catch (error) {
        next(error);
    }
};

export const getCustomLevelById = async (req, res, next) => {
    try {
        const customLevel = await CustomLevel.findByPk(req.params.id);
        if (!customLevel) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Custom Level not found.');
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Custom Level fetched successfully.', customLevel);
    } catch (error) {
        next(error);
    }
};

export const updateCustomLevel = async (req, res, next) => {
    try {
        const { name, status } = req.body;
        const customLevel = await CustomLevel.findByPk(req.params.id);

        if (!customLevel) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Custom Level not found.');
        }

        if (name !== undefined) customLevel.name = name.trim();
        if (status) customLevel.status = status;

        await customLevel.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Custom Level updated successfully.', customLevel);
    } catch (error) {
        next(error);
    }
};

export const deleteCustomLevel = async (req, res, next) => {
    try {
        const customLevel = await CustomLevel.findByPk(req.params.id);

        if (!customLevel) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Custom Level not found.');
        }

        customLevel.status = 'Deleted';
        await customLevel.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Custom Level deleted successfully.');
    } catch (error) {
        next(error);
    }
};
