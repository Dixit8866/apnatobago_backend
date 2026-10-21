import NotificationSetting from '../../models/superadmin-models/NotificationSetting.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import logger from '../../logger/apiLogger.js';
import { sendToDevice, sendDataOnlyToDevice } from '../../services/notification.service.js';

// Notification types that carry an admin-uploaded sound (same as orderNotificationCron)
const TEST_SOUND_TYPES = {
    daily_order: { sound: 'dailyOrderSound', title: 'dailyOrderTitle', message: 'dailyOrderMessage' },
    no_order: { sound: 'noOrderSound', title: 'noOrderTitle', message: 'noOrderMessage' }
};

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

/**
 * @desc    Send a test push with the admin-uploaded sound to the logged-in party's own device.
 *          Same payload as the order notification cron (type, channel, data.soundUrl), so the
 *          app team can test custom sound playback without waiting for a cron slot.
 * @route   POST /api/user/notification-settings/test-sound
 * @body    type      'daily_order' (default) | 'no_order'
 *          soundUrl  optional, overrides the uploaded sound for this test
 *          title, message  optional overrides
 *          dataOnly  true = data-only FCM message (no system notification, app code handles it)
 */
export const sendTestSoundNotification = async (req, res, next) => {
    try {
        const { type = 'daily_order', soundUrl, title, message } = req.body || {};
        const dataOnly = req.body?.dataOnly === true || req.body?.dataOnly === 'true';

        const fields = TEST_SOUND_TYPES[type];
        if (!fields) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Invalid type. Use one of: ${Object.keys(TEST_SOUND_TYPES).join(', ')}`);
        }
        if (soundUrl && !/^https?:\/\//i.test(soundUrl)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'soundUrl must be a full http(s) URL.');
        }
        if (!req.user?.fcmtoken) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'No FCM token saved for this user. Log in on the app first.');
        }

        let setting = await NotificationSetting.findOne();
        if (!setting) {
            setting = await NotificationSetting.create({});
        }

        const finalTitle = title || setting[fields.title];
        const finalBody = message || setting[fields.message];
        const data = { type, soundUrl: soundUrl || setting[fields.sound] || '', test: 'true' };

        const result = dataOnly
            ? await sendDataOnlyToDevice(req.user.fcmtoken, { ...data, title: finalTitle, body: finalBody, action: 'categories' })
            : await sendToDevice(req.user.fcmtoken, finalTitle, finalBody, null, data);

        const tokenResults = (result.results || []).map(r => ({
            token: `${String(r.token).substring(0, 15)}...`,
            success: r.success,
            ...(r.error && { error: r.error })
        }));

        const payload = {
            type,
            dataOnly,
            androidChannelId: `${type}_channel`,
            title: finalTitle,
            body: finalBody,
            soundUrl: data.soundUrl,
            results: tokenResults
        };

        if (!result.success) {
            logger.error(`[Test Sound Notification] Failed for user ${req.user.id}: ${result.error || 'all tokens failed'}`);
            return sendErrorResponse(res, HTTP_STATUS.BAD_GATEWAY, result.error || 'FCM send failed for all tokens.', payload);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Test notification sent.', payload);
    } catch (error) {
        logger.error(`Error in sendTestSoundNotification: ${error.message}`);
        next(error);
    }
};
