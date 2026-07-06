import { OrderAssignment, Order, DeliveryBoy, User, OrderItem, Product, ProductVariant, Volume } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * @desc    Assign multiple orders to a delivery boy
 * @route   POST /api/admin/order-assignments/bulk
 */
export const bulkAssignOrders = async (req, res) => {
    try {
        const { orderIds, deliveryBoyId } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No orders selected for assignment.");
        }

        const boy = await DeliveryBoy.findByPk(deliveryBoyId);
        if (!boy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Delivery boy not found.");
        }

        const assignments = [];
        for (const orderId of orderIds) {
            // Check if already assigned
            const existing = await OrderAssignment.findOne({ where: { orderId } });
            if (existing) {
                await existing.update({ deliveryBoyId, status: 'Assigned', assignedAt: new Date() });
                assignments.push(existing);
            } else {
                const created = await OrderAssignment.create({ orderId, deliveryBoyId, status: 'Assigned' });
                assignments.push(created);
            }
        }

        // Re-fetch assignments without the internal orderId to avoid confusion in the response
        const finalAssignments = await OrderAssignment.findAll({
            where: { orderId: { [Op.in]: orderIds } },
            attributes: { exclude: ['orderId'] },
            include: [{ model: Order, as: 'order', attributes: ['id', 'orderId'] }]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${orderIds.length} orders assigned successfully.`, finalAssignments);
    } catch (error) {
        logger.error(`[Bulk Assign Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all order assignments (for Delivery Label page)
 * @route   GET /api/admin/order-assignments
 */
export const getAllAssignments = async (req, res) => {
    try {
        const { search } = req.query;
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const where = {};

        if (search) {
            where[Op.or] = [
                { '$order.orderId$': { [Op.iLike]: `%${search}%` } },
                { '$order.customerName$': { [Op.iLike]: `%${search}%` } },
                { '$order.customerNumber$': { [Op.iLike]: `%${search}%` } },
                { '$order.user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$order.user.number$': { [Op.iLike]: `%${search}%` } },
                { '$order.user.city$': { [Op.iLike]: `%${search}%` } },
                { '$deliveryBoy.name$': { [Op.iLike]: `%${search}%` } },
                { '$deliveryBoy.phone$': { [Op.iLike]: `%${search}%` } },
                { '$deliveryBoy.vehicleNumber$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        const result = await OrderAssignment.findAndCountAll({
            where,
            attributes: { exclude: ['orderId'] },
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'customerName', 'customerNumber', 'totalAmount', 'orderStatus', 'createdAt', 'shippingAddress', 'paymentMethod', 'paymentStatus'],
                    include: [
                        { model: User, as: 'user', attributes: ['fullname', 'number', 'city', 'postcode'] },
                        {
                            model: OrderItem,
                            as: 'items',
                            include: [
                                { model: Product, as: 'product', attributes: ['id', 'name', 'mainCategoryId'] },
                                {
                                    model: ProductVariant,
                                    as: 'variant',
                                    attributes: ['id', 'volume', 'volumeId'],
                                    include: [
                                        { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                                    ]
                                }
                            ]
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone', 'vehicleNumber']
                }
            ],
            limit,
            offset,
            order: [['assignedAt', 'DESC']],
            distinct: true
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order assignments fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get All Assignments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update assignment status
 * @route   PUT /api/admin/order-assignments/:id
 */
export const updateAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, deliveryBoyId } = req.body;

        const assignment = await OrderAssignment.findByPk(id);
        if (!assignment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        await assignment.update({ status, deliveryBoyId });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assignment updated successfully.", assignment);
    } catch (error) {
        logger.error(`[Update Assignment Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delete assignment (unassign)
 * @route   DELETE /api/admin/order-assignments/:id
 */
export const deleteAssignment = async (req, res) => {
    try {
        const { id } = req.params;
        const assignment = await OrderAssignment.findByPk(id);

        if (!assignment) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Assignment not found.");
        }

        await assignment.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order unassigned successfully.");
    } catch (error) {
        logger.error(`[Delete Assignment Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
