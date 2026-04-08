import Language from '../../models/superadmin-models/Language.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

export const createLanguage = async (req, res, next) => {
    try {
        const { name, code, status } = req.body;

        const existing = await Language.findOne({
            where: { [Op.or]: [{ name }, { code }] },
            paranoid: false // Check even deleted ones to avoid conflicts
        });

        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Language with this name or code already exists.");
        }

        const language = await Language.create({ name, code, status });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Language created successfully.", language);
    } catch (error) {
        next(error);
    }
};

export const getLanguages = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};
        // Base search filter (only text search, no status overrides for counts)
        let searchOnlyWhere = {};

        if (search) {
            const searchFilter = {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { code: { [Op.iLike]: `%${search}%` } }
                ]
            };
            whereClause = { ...whereClause, ...searchFilter };
            searchOnlyWhere = { ...searchFilter };
        }

        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' }; // Hide deleted from 'All' grid
        }

        const pagination = getPaginationOptions(req.query);

        // Parallel count queries
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Language.count({ where: { ...searchOnlyWhere, status: 'Active' } }),
            Language.count({ where: { ...searchOnlyWhere, status: 'Inactive' } }),
            Language.count({ where: { ...searchOnlyWhere, status: 'Deleted' } }),
            Language.count({ where: { ...searchOnlyWhere } })
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const languages = await Language.findAll({ where: whereClause, order: [['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Languages fetched successfully.", { languages, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await Language.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Languages fetched successfully.", { ...responseData, statusCounts });
    } catch (error) {
        next(error);
    }
};

export const getLanguageById = async (req, res, next) => {
    try {
        const language = await Language.findByPk(req.params.id);
        if (!language) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Language not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Language fetched successfully.", language);
    } catch (error) {
        next(error);
    }
};

export const updateLanguage = async (req, res, next) => {
    try {
        const { name, code, status } = req.body;
        const language = await Language.findByPk(req.params.id);
        if (!language) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Language not found.");

        await language.update({ name, code, status });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Language updated successfully.", language);
    } catch (error) {
        next(error);
    }
};

export const deleteLanguage = async (req, res, next) => {
    try {
        const language = await Language.findByPk(req.params.id);
        if (!language) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Language not found.");

        language.status = 'Deleted';
        await language.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Language deleted successfully.");
    } catch (error) {
        next(error);
    }
};
