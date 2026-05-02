import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, Volume } from '../../models/index.js';
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
        const { status } = req.query; // 'Pending', 'Assigned', 'Cancelled', 'Completed'

        const whereClause = { deliveryBoyId };
        if (status) {
            whereClause.status = status;
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await OrderAssignment.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Order,
                    as: 'order',
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
            order: [['assignedAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Assigned orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get My Assigned Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
