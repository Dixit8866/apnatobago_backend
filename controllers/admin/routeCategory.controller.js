import RouteCategory from '../../models/superadmin-models/RouteCategory.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createRouteCategory = async (req, res, next) => {
    try {
        const { name, pincode, status } = req.body;

        if (!name || !name.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Route name is required.");
        }
        if (!pincode || !pincode.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Pincode is required.");
        }

        const normalizedName = name.trim();
        const normalizedPincode = pincode.trim();

        // Check for existing active/inactive route with the same name
        const existing = await RouteCategory.findOne({
            where: {
                name: sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), normalizedName.toLowerCase()),
                status: { [Op.ne]: 'Deleted' }
            }
        });

        if (existing) {
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                "Route Category with this name already exists. (આ નામવાળી રૂટ કેટેગરી પહેલેથી અસ્તિત્વમાં છે.)"
            );
        }

        const routeCategory = await RouteCategory.create({
            name: normalizedName,
            pincode: normalizedPincode,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Route Category created successfully.", routeCategory);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL (with pagination, search, status filters) ─────────────────────
export const getRouteCategories = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        // Search clause for name or pincode
        let searchWhere = {};
        if (search.trim()) {
            searchWhere = {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { pincode: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }

        const whereClause = { ...searchWhere };
        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' }; // Hide deleted by default
        }

        // Calculate counts for tabs
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            RouteCategory.count({ where: { ...searchWhere, status: 'Active' } }),
            RouteCategory.count({ where: { ...searchWhere, status: 'Inactive' } }),
            RouteCategory.count({ where: { ...searchWhere, status: 'Deleted' } }),
            RouteCategory.count({ where: { ...searchWhere, status: { [Op.ne]: 'Deleted' } } }), // Total excluding deleted for default
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const categories = await RouteCategory.findAll({
                where: whereClause,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Categories fetched successfully.", { categories, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await RouteCategory.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Categories fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getRouteCategoryById = async (req, res, next) => {
    try {
        const routeCategory = await RouteCategory.findByPk(req.params.id);
        if (!routeCategory) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Category not found.");
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Category fetched successfully.", routeCategory);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateRouteCategory = async (req, res, next) => {
    try {
        const { name, pincode, status } = req.body;
        const routeCategory = await RouteCategory.findByPk(req.params.id);
        if (!routeCategory) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Category not found.");
        }

        if (name && name.trim()) {
            const normalizedName = name.trim();
            // Check for duplicate names (excluding current record)
            const existing = await RouteCategory.findOne({
                where: {
                    id: { [Op.ne]: req.params.id },
                    name: sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), normalizedName.toLowerCase()),
                    status: { [Op.ne]: 'Deleted' }
                }
            });

            if (existing) {
                return sendErrorResponse(
                    res,
                    HTTP_STATUS.BAD_REQUEST,
                    "Route Category with this name already exists. (આ નામવાળી રૂટ કેટેગરી પહેલેથી અસ્તિત્વમાં છે.)"
                );
            }
            routeCategory.name = normalizedName;
        }

        if (pincode !== undefined) {
            routeCategory.pincode = pincode.trim();
        }

        if (status) {
            routeCategory.status = status;
        }

        await routeCategory.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Category updated successfully.", routeCategory);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE ─────────────────────────────────────────────────────────────
export const deleteRouteCategory = async (req, res, next) => {
    try {
        const routeCategory = await RouteCategory.findByPk(req.params.id);
        if (!routeCategory) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Category not found.");
        }

        routeCategory.status = 'Deleted';
        await routeCategory.save();

        // Optional: Call sequelize destroy so that paranoid soft-delete timestamp is also populated.
        await routeCategory.destroy();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Category deleted successfully.");
    } catch (error) {
        next(error);
    }
};
