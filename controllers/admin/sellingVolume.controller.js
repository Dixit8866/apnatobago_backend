import SellingVolume from '../../models/superadmin-models/SellingVolume.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createSellingVolume = async (req, res, next) => {
    try {
        const { name, status } = req.body;

        if (!name || typeof name !== 'object' || !Object.values(name).some(v => v?.trim())) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide a selling volume name in at least one language.");
        }

        const sellingVolume = await SellingVolume.create({
            name,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Selling Volume created successfully.", sellingVolume);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL ─────────────────────────────────────────────────────────────────
export const getSellingVolumes = async (req, res, next) => {
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
            SellingVolume.count({ where: { ...searchWhere, status: 'Active' } }),
            SellingVolume.count({ where: { ...searchWhere, status: 'Inactive' } }),
            SellingVolume.count({ where: { ...searchWhere, status: 'Deleted' } }),
            SellingVolume.count({ where: { ...searchWhere } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const sellingVolumes = await SellingVolume.findAll({
                where: whereWithSearch,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Selling Volumes fetched successfully.", { sellingVolumes, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await SellingVolume.findAndCountAll({
            where: whereWithSearch,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Selling Volumes fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getSellingVolumeById = async (req, res, next) => {
    try {
        const sellingVolume = await SellingVolume.findByPk(req.params.id);
        if (!sellingVolume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Selling Volume not found.");

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Selling Volume fetched successfully.", sellingVolume);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateSellingVolume = async (req, res, next) => {
    try {
        const { name, status } = req.body;
        const sellingVolume = await SellingVolume.findByPk(req.params.id);
        if (!sellingVolume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Selling Volume not found.");

        await sellingVolume.update({
            name: name ?? sellingVolume.name,
            status: status ?? sellingVolume.status,
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Selling Volume updated successfully.", sellingVolume);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE ─────────────────────────────────────────────────────────────
export const deleteSellingVolume = async (req, res, next) => {
    try {
        const sellingVolume = await SellingVolume.findByPk(req.params.id);
        if (!sellingVolume) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Selling Volume not found.");

        sellingVolume.status = 'Deleted';
        await sellingVolume.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Selling Volume deleted successfully.");
    } catch (error) {
        next(error);
    }
};
