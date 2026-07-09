import { Offer, MainCategory, SubCategory, Product } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

export const createOffer = async (req, res, next) => {
    try {
        const { image, name, type, startDate, endDate, description, mainCategoryId, subCategoryId, productId, status } = req.body;
        
        // Get max position for auto-increment
        const maxPos = await Offer.max('position') || 0;
        const offer = await Offer.create({
            image, name, type, startDate, endDate, description, mainCategoryId, subCategoryId, productId, status,
            position: maxPos + 1
        });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Offer created successfully.", offer);
    } catch (error) {
        next(error);
    }
};

export const getOffers = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};
        let searchOnlyWhere = {};

        if (search) {
            const searchFilter = {
                [Op.or]: [
                    sequelize.where(sequelize.cast(sequelize.col('name'), 'text'), { [Op.iLike]: `%${search}%` }),
                    sequelize.where(sequelize.cast(sequelize.col('description'), 'text'), { [Op.iLike]: `%${search}%` })
                ]
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

        // Status count queries
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Offer.count({ where: { ...searchOnlyWhere, status: 'Active' } }),
            Offer.count({ where: { ...searchOnlyWhere, status: 'Inactive' } }),
            Offer.count({ where: { ...searchOnlyWhere, status: 'Deleted' } }),
            Offer.count({ where: { ...searchOnlyWhere } })
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const offers = await Offer.findAll({
                where: whereClause,
                include: [
                    { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                    { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                    { model: Product, as: 'product', attributes: ['id', 'name'] }
                ],
                order: [['position', 'ASC'], ['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Offers fetched successfully.", { offers, statusCounts });
        }

        const { limit, offset, page } = pagination;
        const result = await Offer.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: Product, as: 'product', attributes: ['id', 'name'] }
            ],
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offers fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

export const getOfferById = async (req, res, next) => {
    try {
        const offer = await Offer.findByPk(req.params.id, {
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: Product, as: 'product', attributes: ['id', 'name'] }
            ]
        });
        if (!offer) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Offer not found.");
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offer fetched successfully.", offer);
    } catch (error) {
        next(error);
    }
};

export const updateOffer = async (req, res, next) => {
    try {
        const { image, name, type, startDate, endDate, description, mainCategoryId, subCategoryId, productId, status } = req.body;
        const offer = await Offer.findByPk(req.params.id);
        if (!offer) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Offer not found.");

        await offer.update({ image, name, type, startDate, endDate, description, mainCategoryId, subCategoryId, productId, status });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offer updated successfully.", offer);
    } catch (error) {
        next(error);
    }
};

export const deleteOffer = async (req, res, next) => {
    try {
        const offer = await Offer.findByPk(req.params.id);
        if (!offer) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Offer not found.");

        offer.status = 'Deleted';
        await offer.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offer deleted successfully.");
    } catch (error) {
        next(error);
    }
};

export const reorderOffers = async (req, res, next) => {
    try {
        const { items } = req.body; 
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Items array is required.");
        }

        for (const item of items) {
            await Offer.update(
                { position: item.position },
                { where: { id: item.id } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offers reordered successfully.");
    } catch (error) {
        next(error);
    }
};

export const moveOfferToTop = async (req, res, next) => {
    try {
        const { id } = req.params;
        const offer = await Offer.findByPk(id);
        if (!offer) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Offer not found.");

        const minPosition = await Offer.min('position') || 0;
        const transaction = await Offer.sequelize.transaction();

        try {
            await Offer.increment('position', { by: 1, where: {}, transaction });
            offer.position = minPosition;
            await offer.save({ transaction });
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Offer moved to top successfully.");
    } catch (error) {
        next(error);
    }
};
