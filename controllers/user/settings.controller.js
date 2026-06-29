import AppSettings from '../../models/superadmin-models/AppSettings.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get App Settings (delivery charges, versions, etc.)
 * @route   GET /api/user/settings
 * @access  Private (User)
 */
export const getAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();

        if (!settings) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", {
                deliveryOnRoundCharge: 0,
                expressDeliveryCharge: 0,
                showExpressDelivery: false,
                freeDeliveryThreshold: 0,
                supportPhoneNumber: '',
                androidVersion: '1.0.0',
                iosVersion: '1.0.0',
                forceUpdate: false,
                deliveryAndroidVersion: '1.0.0',
                deliveryIosVersion: '1.0.0',
                deliveryForceUpdate: false,
                deliveryRoundSchedules: [],
                morningDeliveryStart: '08:00',
                morningDeliveryEnd: '13:00',
                eveningDeliveryStart: '15:00',
                eveningDeliveryEnd: '17:00',
                expressDeliveryStart: '08:00',
                expressDeliveryEnd: '18:00',
                expressDeliverySchedules: []
            });
        }

        const settingsData = settings.toJSON();
        delete settingsData.razorpaySecretKey;

        if (Array.isArray(settingsData.deliveryRoundSchedules)) {
            settingsData.deliveryRoundSchedules = settingsData.deliveryRoundSchedules.map((round, index) => ({
                id: round.id || `round_${index + 1}`,
                ...round
            }));
        }

        if (Array.isArray(settingsData.expressDeliverySchedules)) {
            settingsData.expressDeliverySchedules = settingsData.expressDeliverySchedules.map((round, index) => ({
                id: round.id || `express_${index + 1}`,
                ...round
            }));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", settingsData);
    } catch (error) {
        logger.error(`[Get App Settings Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch app settings");
    }
};
