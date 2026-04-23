import { AppSettings } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get global app settings
 * @route   GET /api/admin/settings
 * @access  Private (Admin)
 */
export const getAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();
        
        if (!settings) {
            // Create default settings if not exists
            settings = await AppSettings.create({});
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Settings fetched successfully", settings);
    } catch (error) {
        logger.error(`Error in getAppSettings: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update global app settings
 * @route   PUT /api/admin/settings
 * @access  Private (Admin)
 */
export const updateAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();
        
        if (!settings) {
            settings = await AppSettings.create(req.body);
        } else {
            await settings.update(req.body);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Settings updated successfully", settings);
    } catch (error) {
        logger.error(`Error in updateAppSettings: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
