import { HelpSupport } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Submit a help and support request
 * @route   POST /api/user/help-support
 * @access  Private
 */
export const submitHelpRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { customerName, shopName, mobileNumber, message } = req.body;

        if (!customerName || !mobileNumber || !message) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: customerName, mobileNumber, message.");
        }

        const helpRequest = await HelpSupport.create({
            userId,
            customerName,
            shopName,
            mobileNumber,
            message
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Support request submitted successfully.", helpRequest);
    } catch (error) {
        logger.error(`[Submit Help Request Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get user's own help requests
 * @route   GET /api/user/help-support
 * @access  Private
 */
export const getMyHelpRequests = async (req, res) => {
    try {
        const userId = req.user.id;
        const requests = await HelpSupport.findAll({ 
            where: { userId },
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Help requests fetched successfully.", requests);
    } catch (error) {
        logger.error(`[Get My Help Requests Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
