import User from '../../models/user/User.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Common API to save/edit/update a user's latitude and longitude
 *          Accessible by both Admin and Delivery Boy roles
 * @route   PUT /api/admin/users/:id/location
 *          PUT /api/delivery/users/:id/location
 * @access  Private (Admin or Delivery Boy)
 */
export const updateUserLocation = async (req, res, next) => {
    try {
        const userId = req.params.id || req.body.userId || req.body.id;
        const { latitude, longitude } = req.body;

        logger.info(`[Update User Location]: Location update request for User ID: ${userId}. Lat: ${latitude}, Long: ${longitude}`);

        if (!userId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "User ID is required.");
        }

        if (latitude === undefined || longitude === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Both latitude and longitude are required.");
        }

        // Parse and validate geographic coordinates
        const latVal = parseFloat(latitude);
        const lngVal = parseFloat(longitude);

        if (isNaN(latVal) || latVal < -90 || latVal > 90) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid latitude. Must be between -90 and 90.");
        }

        if (isNaN(lngVal) || lngVal < -180 || lngVal > 180) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid longitude. Must be between -180 and 180.");
        }

        // Find the user in the database
        const user = await User.findByPk(userId);
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
        }

        // Save new latitude and longitude
        await user.update({
            latitude: latVal,
            longitude: lngVal
        });

        logger.info(`[Update User Location Success]: User ${user.fullname} (${userId}) coordinates updated to Lat: ${latVal}, Long: ${lngVal}`);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "User coordinates updated successfully.", {
            id: user.id,
            fullname: user.fullname,
            number: user.number,
            latitude: parseFloat(user.latitude),
            longitude: parseFloat(user.longitude)
        });
    } catch (error) {
        logger.error(`[Update User Location Error]: ${error.message}`);
        next(error);
    }
};
