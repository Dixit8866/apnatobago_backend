import { HelpSupport, User } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * @desc    Get all help and support requests for admin
 * @route   GET /api/admin/help-support
 * @access  Private (Admin)
 */
export const getAllHelpRequests = async (req, res) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await HelpSupport.findAndCountAll({
            include: [{ model: User, as: 'user', attributes: ['fullname', 'number'] }],
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "All help requests fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Admin Get Help Requests Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update help request status
 * @route   PUT /api/admin/help-support/:id/status
 * @access  Private (Admin)
 */
export const updateHelpRequestStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const request = await HelpSupport.findByPk(id);

        if (!request) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Help request not found.");
        }

        request.status = status;
        await request.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Help request status updated.", request);
    } catch (error) {
        logger.error(`[Admin Update Help Request Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
