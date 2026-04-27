import { AdminNotification } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get recent admin notifications
 * @route   GET /api/admin/admin-notifications
 */
export const getAdminNotifications = async (req, res) => {
    try {
        const notifications = await AdminNotification.findAll({
            limit: 20,
            order: [['createdAt', 'DESC']]
        });

        const unreadCount = await AdminNotification.count({
            where: { isRead: false }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Admin notifications fetched successfully.", {
            notifications,
            unreadCount
        });
    } catch (error) {
        logger.error(`[Get Admin Notifications Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Mark notification as read
 * @route   PUT /api/admin/admin-notifications/:id/read
 */
export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const notification = await AdminNotification.findByPk(id);

        if (!notification) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Notification not found.");
        }

        await notification.update({ isRead: true });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Notification marked as read.");
    } catch (error) {
        logger.error(`[Mark Notification Read Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Mark all as read
 * @route   PUT /api/admin/admin-notifications/read-all
 */
export const markAllAsRead = async (req, res) => {
    try {
        await AdminNotification.update({ isRead: true }, { where: { isRead: false } });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "All notifications marked as read.");
    } catch (error) {
        logger.error(`[Mark All Read Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
