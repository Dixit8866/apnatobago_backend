import AdminRole from '../../models/superadmin-models/AdminRole.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

export const createRole = async (req, res, next) => {
    try {
        const { name, status } = req.body;

        const existing = await AdminRole.findOne({
            where: { name },
        });

        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Role with this name already exists.");
        }

        const role = await AdminRole.create({ name, status });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Role created successfully.", role);
    } catch (error) {
        next(error);
    }
};

export const getRoles = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};
        let searchOnlyWhere = {};

        if (search) {
            const searchFilter = {
                name: { [Op.iLike]: `%${search}%` }
            };
            whereClause = { ...whereClause, ...searchFilter };
            searchOnlyWhere = { ...searchFilter };
        }

        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' };
        }

        const pagination = getPaginationOptions(req.query);

        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            AdminRole.count({ where: { ...searchOnlyWhere, status: 'Active' } }),
            AdminRole.count({ where: { ...searchOnlyWhere, status: 'Inactive' } }),
            AdminRole.count({ where: { ...searchOnlyWhere, status: 'Deleted' } }),
            AdminRole.count({ where: { ...searchOnlyWhere } })
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const roles = await AdminRole.findAll({ where: whereClause, order: [['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Roles fetched successfully.", { roles, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await AdminRole.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Roles fetched successfully.", { ...responseData, statusCounts });
    } catch (error) {
        next(error);
    }
};

export const getRoleById = async (req, res, next) => {
    try {
        const role = await AdminRole.findByPk(req.params.id);
        if (!role) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Role not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Role fetched successfully.", role);
    } catch (error) {
        next(error);
    }
};

export const updateRole = async (req, res, next) => {
    try {
        const { name, status } = req.body;
        const role = await AdminRole.findByPk(req.params.id);
        if (!role) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Role not found.");

        const existing = await AdminRole.findOne({
            where: { name, id: { [Op.ne]: req.params.id } }
        });
        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Role with this name already exists.");
        }

        await role.update({ name, status });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Role updated successfully.", role);
    } catch (error) {
        next(error);
    }
};

export const deleteRole = async (req, res, next) => {
    try {
        const role = await AdminRole.findByPk(req.params.id);
        if (!role) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Role not found.");

        role.status = 'Deleted';
        await role.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Role deleted successfully.");
    } catch (error) {
        next(error);
    }
};
