import { Banner } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

export const createBanner = async (req, res, next) => {
    try {
        const { image, title, status } = req.body;
        
        // Get max position for auto-increment
        const maxPos = await Banner.max('position') || 0;
        const banner = await Banner.create({
            image, title, status,
            position: maxPos + 1
        });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Banner created successfully.", banner);
    } catch (error) {
        next(error);
    }
};

export const getBanners = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};
        let searchOnlyWhere = {};

        if (search) {
            const searchFilter = { [Op.or]: [{ "title": { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }] };
            whereClause = { ...whereClause, ...searchFilter };
            searchOnlyWhere = { ...searchFilter };
        }

        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' }; 
        }

        const pagination = getPaginationOptions(req.query);

        // Status count queries
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Banner.count({ where: { ...searchOnlyWhere, status: 'Active' } }),
            Banner.count({ where: { ...searchOnlyWhere, status: 'Inactive' } }),
            Banner.count({ where: { ...searchOnlyWhere, status: 'Deleted' } }),
            Banner.count({ where: { ...searchOnlyWhere } })
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const banners = await Banner.findAll({ where: whereClause, order: [['position', 'ASC'], ['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners fetched successfully.", { banners, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await Banner.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

export const getBannerById = async (req, res, next) => {
    try {
        const banner = await Banner.findByPk(req.params.id);
        if (!banner) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Banner not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banner fetched successfully.", banner);
    } catch (error) {
        next(error);
    }
};

export const updateBanner = async (req, res, next) => {
    try {
        const { image, title, status } = req.body;
        const banner = await Banner.findByPk(req.params.id);
        if (!banner) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Banner not found.");

        await banner.update({ image, title, status });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banner updated successfully.", banner);
    } catch (error) {
        next(error);
    }
};

export const deleteBanner = async (req, res, next) => {
    try {
        const banner = await Banner.findByPk(req.params.id);
        if (!banner) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Banner not found.");

        banner.status = 'Deleted';
        await banner.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banner deleted successfully.");
    } catch (error) {
        next(error);
    }
};

export const reorderBanners = async (req, res, next) => {
    try {
        const { items } = req.body; 
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Items array is required.");
        }

        for (const item of items) {
            await Banner.update(
                { position: item.position },
                { where: { id: item.id } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banners reordered successfully.");
    } catch (error) {
        next(error);
    }
};

export const moveBannerToTop = async (req, res, next) => {
    try {
        const { id } = req.params;
        const banner = await Banner.findByPk(id);
        if (!banner) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Banner not found.");

        const minPosition = await Banner.min('position') || 0;
        const transaction = await Banner.sequelize.transaction();

        try {
            await Banner.increment('position', { by: 1, where: {}, transaction });
            banner.position = minPosition;
            await banner.save({ transaction });
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Banner moved to top successfully.");
    } catch (error) {
        next(error);
    }
};
