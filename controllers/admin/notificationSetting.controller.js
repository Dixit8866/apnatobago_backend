import NotificationSetting from '../../models/superadmin-models/NotificationSetting.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import logger from '../../logger/apiLogger.js';

export const getNotificationSettings = async (req, res, next) => {
    try {
        let setting = await NotificationSetting.findOne();
        if (!setting) {
            setting = await NotificationSetting.create({});
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Notification settings fetched successfully.', setting);
    } catch (error) {
        logger.error(`Error in getNotificationSettings: ${error.message}`);
        next(error);
    }
};

export const updateNotificationSettings = async (req, res, next) => {
    try {
        let setting = await NotificationSetting.findOne();
        if (!setting) {
            setting = await NotificationSetting.create(req.body);
        } else {
            await setting.update(req.body);
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Notification settings updated successfully.', setting);
    } catch (error) {
        logger.error(`Error in updateNotificationSettings: ${error.message}`);
        next(error);
    }
};
