import { Op } from 'sequelize';
import { DeliveryBoy } from '../../models/index.js';
import { sendSuccessResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';

/**
 * @desc    Get delivery boys (all for now, can be extended with godownId FK later)
 * @route   GET /api/godown-panel/delivery
 * @access  Private (GodownStaff)
 */
export const getGodownDeliveryBoys = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, search = '', status = '' } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const where = {
            ...(status && { status }),
            ...(search && {
                [Op.or]: [
                    { name: { [Op.iLike]: `%${search}%` } },
                    { number: { [Op.iLike]: `%${search}%` } },
                ]
            }),
        };

        const { count, rows } = await DeliveryBoy.findAndCountAll({
            where,
            attributes: { exclude: ['password'] },
            limit: parseInt(limit),
            offset,
            order: [['createdAt', 'DESC']],
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Delivery boys fetched', {
            data: rows,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalRecords: count,
        });
    } catch (error) {
        next(error);
    }
};
