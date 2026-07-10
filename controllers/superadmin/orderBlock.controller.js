import { OrderBlockSetting } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get order block settings
 * @route   GET /api/admin/order-block
 * @access  Private (Admin)
 */
export const getOrderBlockSetting = async (req, res) => {
    try {
        let setting = await OrderBlockSetting.findOne();
        
        if (!setting) {
            // Create default settings if not exists
            setting = await OrderBlockSetting.create({
                isBlocked: false,
                type: 'Under Maintenance',
                fromDate: null,
                toDate: null,
                title: '',
                description: '',
                message: ''
            });
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order block settings fetched successfully", setting);
    } catch (error) {
        logger.error(`Error in getOrderBlockSetting: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update order block settings
 * @route   PUT /api/admin/order-block
 * @access  Private (Admin)
 */
export const updateOrderBlockSetting = async (req, res) => {
    try {
        let setting = await OrderBlockSetting.findOne();
        
        const { isBlocked, type, fromDate, toDate, message, title, description } = req.body;
        
        const updateData = {
            isBlocked: isBlocked !== undefined ? isBlocked : false,
            type: type || 'Under Maintenance',
            fromDate: fromDate || null,
            toDate: toDate || null,
            title: title || '',
            description: description || '',
            message: message || ''
        };

        if (!setting) {
            setting = await OrderBlockSetting.create(updateData);
        } else {
            await setting.update(updateData);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order block settings updated successfully", setting);
    } catch (error) {
        logger.error(`Error in updateOrderBlockSetting: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
