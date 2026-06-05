import { Notification } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

/**
 * @desc    Get current user's notifications (topic broadcasts, individual notifications, and order notifications)
 * @route   GET /api/user/notifications
 */
export const getUserNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Notification.findAndCountAll({
            where: {
                [Op.or]: [
                    { type: 'TOPIC' },
                    { target: String(userId) }
                ]
            },
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "User notifications fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[User Get Notifications Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
