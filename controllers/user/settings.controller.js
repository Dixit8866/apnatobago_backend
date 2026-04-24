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

        // If no settings exist yet, return defaults
        if (!settings) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", {
                deliveryOnRoundCharge: 0,
                expressDeliveryCharge: 0,
                freeDeliveryThreshold: 0,
                androidVersion: '1.0.0',
                iosVersion: '1.0.0',
                forceUpdate: false
            });
        }

        const settingsData = settings.toJSON();
        delete settingsData.razorpaySecretKey;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", settingsData);
    } catch (error) {
        logger.error(`[Get App Settings Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch app settings");
    }
};
