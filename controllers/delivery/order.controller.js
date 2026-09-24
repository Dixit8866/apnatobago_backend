import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { Order, User } from '../../models/index.js';
import { clearOrderDeliveryNotice } from '../../services/financialSettlement.service.js';
import {
    getMyAssignedOrdersService,
    getAssignmentDetailsService,
    getUserPreviousBillsService,
    reorderAssignmentsService,
    updateMyAssignmentStatusService
} from '../../services/delivery/deliveryOrder.service.js';
import {
    completeOrderAndSettlePaymentService,
    settleSingleOrderPaymentService,
    submitDeliveryBankPaymentService,
    restoreUserCreditFromPayment
} from '../../services/delivery/deliverySettlement.service.js';
import { scanAndAssignOrderService } from '../../services/delivery/deliveryScanner.service.js';

export { restoreUserCreditFromPayment };


/**
 * ==============================================================================
 * DELIVERY ORDER CONTROLLER (Service-Based Architecture)
 * ==============================================================================
 * High-performance, clean controller delegating domain logic to specialized services.
 * Maintains 100% backward compatibility with the Delivery Boy Mobile App.
 */

/**
 * @desc    Get assigned orders for the logged-in delivery boy
 * @route   GET /api/delivery/orders
 * @access  Private (Delivery Boy)
 */
export const getMyAssignedOrders = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        logger.info(`[Get My Assigned Orders]: Fetching orders for delivery boy ${deliveryBoyId}`);

        const responseData = await getMyAssignedOrdersService({
            deliveryBoyId,
            query: req.query
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assigned orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get My Assigned Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get order details for delivery boy
 * @route   GET /api/delivery/orders/details/:assignmentId
 * @access  Private (Delivery Boy)
 */
export const getAssignmentDetails = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const deliveryBoyId = req.user.id;
        logger.info(`[Get Assignment Details]: Fetching assignment ${assignmentId} for delivery boy ${deliveryBoyId}`);

        const data = await getAssignmentDetailsService({
            assignmentId,
            deliveryBoyId
        });

        if (!data) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", data);
    } catch (error) {
        logger.error(`[Get Assignment Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get user previous pending bills/orders with items for delivery boy payment settlement
 * @route   GET /api/delivery/orders/user-previous-bills/:userId
 * @access  Private (Delivery Boy)
 */
export const getUserPreviousBills = async (req, res) => {
    try {
        const { userId } = req.params;
        const currentOrdId = String(req.query.currentOrderId || req.query.excludeOrderId || req.query.orderId || req.query.excludeId || '').trim();

        logger.info(`[Get User Previous Bills]: Fetching previous bills for user ${userId}, excluding current ${currentOrdId}`);

        const result = await getUserPreviousBillsService({
            userId,
            currentOrderId: currentOrdId
        });

        if (!result) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "No orders or user found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Previous bills fetched successfully.", result);
    } catch (error) {
        logger.error(`[Get User Previous Bills Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get user credit details (creditline and blockcredit)
 * @route   GET /api/delivery/orders/user-credit/:userId
 * @access  Private (Delivery Boy)
 */
export const getUserCreditDetails = async (req, res) => {
    try {
        const { userId } = req.params;
        logger.info(`[Get User Credit]: Fetching credit info for user ${userId}`);

        const user = await User.findByPk(userId, {
            attributes: ['id', 'creditline', 'blockcredit']
        });

        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "User credit details fetched.", {
            id: user.id,
            creditline: parseFloat(user.creditline || 0),
            blockcredit: user.blockcredit || false
        });
    } catch (error) {
        logger.error(`[Get User Credit Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk update assignment positions or single item shifting
 * @route   PUT /api/delivery/orders/reorder
 * @access  Private (Delivery Boy)
 */
export const reorderAssignments = async (req, res) => {
    try {
        const { id, fromIndex, toIndex } = req.body;
        const deliveryBoyId = req.user.id;

        if (id === undefined || fromIndex === undefined || toIndex === undefined) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "id, fromIndex, and toIndex are required.");
        }

        await reorderAssignmentsService({
            deliveryBoyId,
            id,
            fromIndex,
            toIndex
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order reordered and shifted successfully.");
    } catch (error) {
        logger.error(`[Reorder Assignments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update assignment status by delivery boy
 * @route   PUT /api/delivery/orders/:assignmentId/status
 * @access  Private (Delivery Boy)
 */
export const updateMyAssignmentStatus = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const { status, notes, note, deliveryNote } = req.body;
        const deliveryBoyId = req.user.id;

        const validStatuses = ['Pending', 'Assigned', 'Cancelled', 'Completed'];
        if (status && !validStatuses.includes(status)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid status.");
        }

        const result = await updateMyAssignmentStatusService({
            assignmentId,
            deliveryBoyId,
            status,
            notes: notes || note || deliveryNote,
            reqUser: req.user
        });

        if (!result) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment or Order not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assignment status updated successfully.", result);
    } catch (error) {
        logger.error(`[Update Assignment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Complete an order and settle multiple payments (current + past dues)
 * @route   PUT /api/delivery/orders/:assignmentId/complete-settle
 * @access  Private (Delivery Boy)
 */
export const completeOrderAndSettlePayment = async (req, res) => {
    try {
        const { assignmentId } = req.params;
        const deliveryBoyId = req.user.id;

        const result = await completeOrderAndSettlePaymentService({
            assignmentId,
            deliveryBoyId,
            body: req.body,
            reqUser: req.user
        });

        if (result.notFound) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        if (result.error) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.error);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order delivered and payments auto-adjusted successfully.");
    } catch (error) {
        logger.error(`[Complete Order Settle Error]: ${error.message}`);
        return res.status(500).json({
            success: false,
            message: error.message,
            debug: {
                deliveryBoyId: req.user?.id,
                userObject: req.user ? { id: req.user.id, name: req.user.fullname || req.user.name } : null,
                assignmentId: req.params.assignmentId
            }
        });
    }
};

/**
 * @desc    Settle a single or multiple specific orders by Order ID or UUID
 * @route   PUT /api/delivery/orders/settle-single
 * @access  Private (Delivery Boy)
 */
export const settleSingleOrderPayment = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;

        const result = await settleSingleOrderPaymentService({
            deliveryBoyId,
            body: req.body,
            reqUser: req.user
        });

        if (result.badRequest) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.badRequest);
        }

        if (result.notFound) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, result.notFound);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders settled successfully.", result);
    } catch (error) {
        logger.error(`[Settle Single Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delivery boy submits bank payment proof (screenshot) for an order
 * @route   POST /api/delivery/orders/:id/bank-payment
 * @access  Private (Delivery Boy)
 */
export const submitDeliveryBankPayment = async (req, res) => {
    try {
        const { id } = req.params;
        const deliveryBoyId = req.user.id;

        const result = await submitDeliveryBankPaymentService({
            orderIdOrUuid: id,
            deliveryBoyId,
            body: req.body,
            files: req.files,
            file: req.file
        });

        if (result.notFound) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        if (result.badRequest) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.badRequest);
        }

        if (result.uploadError) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, result.uploadError);
        }

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Payment proof submitted and order settled successfully. Waiting for admin verification.", result.payment);
    } catch (error) {
        logger.error(`[Delivery Submit Bank Payment Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Scan barcode and assign order to delivery boy
 * @route   POST /api/delivery/orders/scan-assign
 * @access  Private (Delivery Boy)
 */
export const scanAndAssignOrder = async (req, res) => {
    try {
        const { orderId, deliveryBoyId } = req.body;
        const result = await scanAndAssignOrderService({
            orderId,
            deliveryBoyId,
            reqUser: req.user
        });

        if (result.badRequest) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.badRequest);
        }

        if (result.notFound) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, result.notFound);
        }

        if (result.conflict) {
            return sendErrorResponse(res, HTTP_STATUS.CONFLICT, result.message, result.data);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, result.message, result.data);
    } catch (error) {
        logger.error(`[Scan and Assign Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "ઓર્ડર સોંપવામાં ભૂલ આવી (Error assigning order).", error.message);
    }
};

/**
 * @desc    Resolve delivery notice for an order/party (Delivery Boy App)
 * @route   PUT /api/delivery/orders/notice/resolve or PUT /api/delivery/orders/:orderId/resolve-notice
 * @access  Private (Delivery Boy)
 */
export const resolveDeliveryNotice = async (req, res) => {
    try {
        const orderIdParam = req.params.orderId || req.params.id;
        const { orderId: bodyOrderId, userId } = req.body;
        const targetOrderId = orderIdParam || bodyOrderId;

        let targetUserId = userId;
        let ord = null;

        if (targetOrderId) {
            const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(targetOrderId);
            const whereCond = isUuid ? { [Op.or]: [{ id: targetOrderId }, { orderId: targetOrderId }] } : { orderId: targetOrderId };
            ord = await Order.findOne({ where: whereCond });
            if (ord && ord.userId) targetUserId = ord.userId;
        }

        await clearOrderDeliveryNotice({ orderId: ord ? ord.id : targetOrderId, userId: targetUserId });

        logger.info(`[Delivery App Resolve Notice]: Notice resolved centrally for orderId: ${targetOrderId}, userId: ${targetUserId} by delivery boy ${req.user?.id}`);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "નોંધ સફળતાપૂર્વક સોલ્વ થઈ ગઈ છે (Delivery notice resolved successfully).", {
            orderId: targetOrderId,
            userId: targetUserId,
            resolved: true,
            hasNotice: false,
            deliveryNotice: null
        });
    } catch (err) {
        logger.error(`[Delivery App Resolve Notice Error]: ${err.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "નોંધ સોલ્વ કરવામાં ભૂલ આવી (Failed to resolve notice).", err.message);
    }
};

/**
 * @desc    Decline / Acknowledge delivery notice for an order (Delivery Boy App)
 * @route   PUT /api/delivery/orders/notice/decline or PUT /api/delivery/orders/:orderId/decline-notice
 * @access  Private (Delivery Boy)
 */
export const declineDeliveryNotice = async (req, res) => {
    try {
        const orderIdParam = req.params.orderId || req.params.id;
        const { orderId: bodyOrderId, note, notes } = req.body;
        const targetOrderId = orderIdParam || bodyOrderId;

        let ord = null;
        if (targetOrderId) {
            const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(targetOrderId);
            const whereCond = isUuid ? { [Op.or]: [{ id: targetOrderId }, { orderId: targetOrderId }] } : { orderId: targetOrderId };
            ord = await Order.findOne({ where: whereCond });
        }

        const currentNotice = ord?.deliveryNotice || ord?.notes || note || notes || null;
        logger.info(`[Delivery App Decline Notice]: Notice acknowledged for orderId: ${targetOrderId} by delivery boy ${req.user?.id}`);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "નોંધ ધ્યાનમાં લેવાઈ છે (Notice acknowledged).", {
            orderId: targetOrderId,
            acknowledged: true,
            hasNotice: Boolean(currentNotice),
            deliveryNotice: currentNotice
        });
    } catch (err) {
        logger.error(`[Delivery App Decline Notice Error]: ${err.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "નોંધ સ્વીકારવામાં ભૂલ આવી (Failed to process notice action).", err.message);
    }
};
