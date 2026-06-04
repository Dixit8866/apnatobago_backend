import { HelpSupport } from '../../models/index.js';
import { uploadToS3 } from '../../utils/aws.s3.js';
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
        let body = req.body || {};
        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch (e) {
                logger.error(`[Parse Help Request Body Error]: ${e.message}`);
            }
        } else if (body && typeof body.data === 'string') {
            try {
                body = JSON.parse(body.data);
            } catch (e) {
                // Ignore
            }
        } else if (body && typeof body.body === 'string') {
            try {
                body = JSON.parse(body.body);
            } catch (e) {
                // Ignore
            }
        }

        const customerName = body.customerName || req.body.customerName;
        const shopName = body.shopName || req.body.shopName;
        const mobileNumber = body.mobileNumber || req.body.mobileNumber;
        const message = body.message || req.body.message;

        if (!customerName || !mobileNumber || !message) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: customerName, mobileNumber, message.");
        }

        let imageUrl = body.image || req.body.image || null;

        if (req.file) {
            const uploadResult = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
            if (uploadResult.success) {
                imageUrl = uploadResult.url;
            } else {
                logger.error(`[Help Support Image Upload Error]: ${uploadResult.error}`);
            }
        }

        const helpRequest = await HelpSupport.create({
            userId,
            customerName,
            shopName,
            mobileNumber,
            message,
            image: imageUrl
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
