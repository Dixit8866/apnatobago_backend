import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, Volume } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * @desc    Get assigned orders for the logged-in delivery boy
 * @route   GET /api/delivery/orders
 * @access  Private (Delivery Boy)
 */
export const getMyAssignedOrders = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        const { status, search } = req.query; // 'Pending', 'Assigned', 'Cancelled', 'Completed'

        const whereClause = { deliveryBoyId };
        if (status) {
            whereClause.status = status;
        }

        const orderIncludeWhere = {};
        if (search) {
            orderIncludeWhere.orderId = { [Op.iLike]: `%${search}%` };
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await OrderAssignment.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Order,
                    as: 'order',
                    where: Object.keys(orderIncludeWhere).length > 0 ? orderIncludeWhere : null,
                    include: [
                        { model: User, as: 'user', attributes: ['fullname', 'number', 'city', 'postcode'] },
                        { 
                            model: OrderItem, 
                            as: 'items',
                            include: [
                                { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                                { 
                                    model: ProductVariant, 
                                    as: 'variant',
                                    include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }]
                                }
                            ]
                        }
                    ]
                }
            ],
            limit,
            offset,
            order: [['position', 'ASC'], ['assignedAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assigned orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get My Assigned Orders Error]: ${error.message}`);
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
        const { status, notes } = req.body;
        const deliveryBoyId = req.user.id;

        const assignment = await OrderAssignment.findOne({
            where: { id: assignmentId, deliveryBoyId }
        });

        if (!assignment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found or not assigned to you.");
        }

        const validStatuses = ['Pending', 'Assigned', 'Cancelled', 'Completed'];
        if (status && !validStatuses.includes(status)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid status.");
        }

        await assignment.update({ status, notes: notes || assignment.notes });

        // Optionally update the main Order status if needed
        // if (status === 'Completed') {
        //     await Order.update({ orderStatus: 'Delivered' }, { where: { id: assignment.orderId } });
        // }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assignment status updated successfully.", assignment);
    } catch (error) {
        logger.error(`[Update Assignment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk update assignment positions for drag-and-drop reordering
 * @route   PUT /api/delivery/orders/reorder
 * @access  Private (Delivery Boy)
 */
export const reorderAssignments = async (req, res) => {
    try {
        const { assignments } = req.body; // Array of { id, position }
        const deliveryBoyId = req.user.id;

        if (!assignments || !Array.isArray(assignments)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid assignments data.");
        }

        // Perform updates in parallel
        await Promise.all(assignments.map(item => {
            return OrderAssignment.update(
                { position: item.position },
                { where: { id: item.id, deliveryBoyId } }
            );
        }));

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders reordered successfully.");
    } catch (error) {
        logger.error(`[Reorder Assignments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
