import Volume from '../../models/superadmin-models/Volume.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createVolume = async (req, res, next) => {
    try {
        const { name, status } = req.body;

        if (!name || typeof name !== 'object' || !Object.values(name).some(v => v?.trim())) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide a volume name in at least one language.");
        }

        const volume = await Volume.create({
            name,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Volume created successfully.", volume);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getVolumes = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        // Search in JSONB 'name' field
        const searchWhere = search
            ? { name: { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }
            : {};

        const whereWithSearch = { ...searchWhere };
        if (status) {
            whereWithSearch.status = status;
        } else {
            whereWithSearch.status = { [Op.ne]: 'Deleted' }; // Hide deleted from global view
        }

        // Status counts for UI tabs
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Volume.count({ where: { ...searchWhere, status: 'Active' } }),
            Volume.count({ where: { ...searchWhere, status: 'Inactive' } }),
            Volume.count({ where: { ...searchWhere, status: 'Deleted' } }),
            Volume.count({ where: { ...searchWhere } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const volumes = await Volume.findAll({
                where: whereWithSearch,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Volumes fetched successfully.", { volumes, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Volume.findAndCountAll({
            where: whereWithSearch,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Volumes fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getVolumeById = async (req, res, next) => {
    try {
        const volume = await Volume.findByPk(req.params.id);
        if (!volume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Volume not found.");

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Volume fetched successfully.", volume);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateVolume = async (req, res, next) => {
    try {
        const { name, status } = req.body;
        const volume = await Volume.findByPk(req.params.id);
        if (!volume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Volume not found.");

        await volume.update({
            name: name ?? volume.name,
            status: status ?? volume.status,
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Volume updated successfully.", volume);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE ─────────────────────────────────────────────────────────────
export const deleteVolume = async (req, res, next) => {
    try {
        const volume = await Volume.findByPk(req.params.id);
        if (!volume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Volume not found.");

        volume.status = 'Deleted';
        await volume.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Volume deleted successfully.");
    } catch (error) {
        next(error);
    }
};
