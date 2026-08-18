import { RouteSection, RouteCategory } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

// Helper to populate areaCategories for a list of route sections
const populateAreaCategories = async (sections) => {
    const allCategoryIds = [...new Set(sections.flatMap(s => s.areaCategoryIds || []))].filter(Boolean);
    let categoryMap = new Map();

    if (allCategoryIds.length > 0) {
        const categories = await RouteCategory.findAll({
            where: {
                id: { [Op.in]: allCategoryIds },
                status: { [Op.ne]: 'Deleted' }
            },
            attributes: ['id', 'name', 'pincode', 'status']
        });
        categories.forEach(c => categoryMap.set(c.id, c.toJSON()));
    }

    return sections.map(s => {
        const plain = typeof s.toJSON === 'function' ? s.toJSON() : s;
        const areaCategories = (plain.areaCategoryIds || [])
            .map(id => categoryMap.get(id))
            .filter(Boolean);
        return {
            ...plain,
            areaCategories
        };
    });
};

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createRouteSection = async (req, res, next) => {
    try {
        const { name, areaCategoryIds, description, status } = req.body;

        if (!name || !name.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Route Section name is required.");
        }

        const normalizedName = name.trim();
        const validCategoryIds = Array.isArray(areaCategoryIds) ? areaCategoryIds.filter(Boolean) : [];

        // Check for existing active/inactive route section with the same name
        const existing = await RouteSection.findOne({
            where: {
                name: sequelize.where(sequelize.fn('LOWER', sequelize.col('name')), normalizedName.toLowerCase()),
                status: { [Op.ne]: 'Deleted' }
            }
        });

        if (existing) {
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                "Route Section with this name already exists. (આ નામવાળું રૂટ સેક્શન પહેલેથી અસ્તિત્વમાં છે.)"
            );
        }

        const maxPos = (await RouteSection.max('position')) || 0;

        const routeSection = await RouteSection.create({
            name: normalizedName,
            areaCategoryIds: validCategoryIds,
            description: description ? description.trim() : null,
            status: status || 'Active',
            position: maxPos + 1
        });

        const [populated] = await populateAreaCategories([routeSection]);

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Route Section created successfully.", populated);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getRouteSections = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        let searchWhere = {};
        if (search.trim()) {
            searchWhere = {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { description: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }

        const whereClause = { ...searchWhere };
        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' };
        }

        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            RouteSection.count({ where: { ...searchWhere, status: 'Active' } }),
            RouteSection.count({ where: { ...searchWhere, status: 'Inactive' } }),
            RouteSection.count({ where: { ...searchWhere, status: 'Deleted' } }),
            RouteSection.count({ where: { ...searchWhere, status: { [Op.ne]: 'Deleted' } } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const rawSections = await RouteSection.findAll({
                where: whereClause,
                order: [['position', 'ASC'], ['createdAt', 'DESC']]
            });
            const sections = await populateAreaCategories(rawSections);
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Sections fetched successfully.", { sections, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await RouteSection.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const populatedRows = await populateAreaCategories(result.rows);
        const responseData = formatPaginatedResponse({ count: result.count, rows: populatedRows }, page, limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Sections fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getRouteSectionById = async (req, res, next) => {
    try {
        const routeSection = await RouteSection.findByPk(req.params.id);
        if (!routeSection) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Section not found.");
        }
        const [populated] = await populateAreaCategories([routeSection]);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Section fetched successfully.", populated);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateRouteSection = async (req, res, next) => {
    try {
        const { name, areaCategoryIds, description, status } = req.body;
        const routeSection = await RouteSection.findByPk(req.params.id);
        if (!routeSection) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Section not found.");
        }

        if (name && name.trim()) {
            const normalizedName = name.trim();
            const existing = await RouteSection.findOne({
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
                    "Route Section with this name already exists. (આ નામવાળું રૂટ સેક્શન પહેલેથી અસ્તિત્વમાં છે.)"
                );
            }
            routeSection.name = normalizedName;
        }

        if (Array.isArray(areaCategoryIds)) {
            routeSection.areaCategoryIds = areaCategoryIds.filter(Boolean);
        }

        if (description !== undefined) {
            routeSection.description = description ? description.trim() : null;
        }

        if (status) {
            routeSection.status = status;
        }

        await routeSection.save();

        const [populated] = await populateAreaCategories([routeSection]);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Section updated successfully.", populated);
    } catch (error) {
        next(error);
    }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
export const deleteRouteSection = async (req, res, next) => {
    try {
        const routeSection = await RouteSection.findByPk(req.params.id);
        if (!routeSection) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Route Section not found.");
        }

        routeSection.status = 'Deleted';
        await routeSection.save();
        await routeSection.destroy();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Route Section deleted successfully.");
    } catch (error) {
        next(error);
    }
};
