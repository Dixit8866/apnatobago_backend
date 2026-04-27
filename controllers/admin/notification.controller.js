import { Notification, User } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { sendToTopic, sendToDevice } from '../../services/notification.service.js';

/**
 * @desc    Send notification (Topic or Individual)
 * @route   POST /api/admin/notifications/send
 */
export const sendNotification = async (req, res) => {
    try {
        const { title, body, imageUrl, type, target, clickAction } = req.body;
        const sentBy = req.admin?.id;

        if (!title || !body || !type || !target) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing required fields.");
        }

        let result;
        if (type === 'TOPIC') {
            result = await sendToTopic(target, title, body, imageUrl, { clickAction });
        } else if (type === 'INDIVIDUAL') {
            const user = await User.findByPk(target);
            if (!user || !user.fcmtoken) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User or FCM token not found.");
            }
            result = await sendToDevice(user.fcmtoken, title, body, imageUrl, { clickAction });
        }

        // Log to database
        const notificationRecord = await Notification.create({
            title,
            body,
            imageUrl,
            type,
            target,
            status: result.success ? 'SENT' : 'FAILED',
            sentBy,
            clickAction
        });

        if (!result.success) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, `Firebase Error: ${result.error}`, notificationRecord);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Notification sent successfully.", notificationRecord);
    } catch (error) {
        logger.error(`[Send Notification Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all notifications
 * @route   GET /api/admin/notifications
 */
export const getAllNotifications = async (req, res) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Notification.findAndCountAll({
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Notifications fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get Notifications Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delete notification log
 * @route   DELETE /api/admin/notifications/:id
 */
export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await Notification.findByPk(id);

        if (!notification) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Notification log not found.");
        }

        await notification.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Notification log deleted successfully.");
    } catch (error) {
        logger.error(`[Delete Notification Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
