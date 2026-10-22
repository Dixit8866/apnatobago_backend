import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { logActivity } from '../../helpers/activityLog.helper.js';
import {
    getAdminCompleteSettleInfoService,
    adminCompleteOrderSettlementService
} from '../../services/adminCompleteSettlement.service.js';

/**
 * @desc    Popup data to complete a Shipping order from admin (bill, party credit, last 5 bills for sales return)
 * @route   GET /api/admin/orders/:id/admin-complete-settle
 * @access  Private (Admin)
 */
export const getAdminCompleteSettleInfo = async (req, res) => {
    try {
        const data = await getAdminCompleteSettleInfoService({ orderId: req.params.id });
        if (!data) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Complete & settle details fetched.", data);
    } catch (error) {
        logger.error(`[Admin Complete Settle Info Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Complete a Shipping order from admin and settle its bill (Cash / Online / Credit / Sales Return / Kupan)
 * @route   PUT /api/admin/orders/:id/admin-complete-settle
 * @access  Private (Admin)
 */
export const adminCompleteSettleOrder = async (req, res) => {
    try {
        const actorName = req.user?.fullname || req.user?.name || 'Admin';
        const result = await adminCompleteOrderSettlementService({
            orderId: req.params.id,
            body: req.body,
            actorName
        });

        if (result.notFound) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }
        if (result.error) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.error);
        }

        logActivity(req, {
            module: 'Order List',
            action: 'PAYMENT',
            description: `Order #${result.order.orderId} completed & settled from admin`,
            metadata: result.order
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "ઓર્ડર Complete થયો અને પેમેન્ટ સેટલ થયું.", result.order);
    } catch (error) {
        logger.error(`[Admin Complete Settle Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
