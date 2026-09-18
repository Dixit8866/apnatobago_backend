import { OrderAssignment, Order, User, OrderItem, Product, ProductVariant, DeliveryBoy, RouteCategory, BusinessProfile } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get all active area / route categories for the delivery app
 * @route   GET /api/delivery/area-categories
 *          GET /api/delivery/orders/area-categories (backward compatibility)
 * @access  Private (Delivery Boy)
 */
export const getDeliveryAreaCategories = async (req, res) => {
    try {
        const categories = await RouteCategory.findAll({
            where: {
                status: 'Active'
            },
            attributes: ['id', 'name', 'pincode'],
            order: [['name', 'ASC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Area categories fetched successfully.", categories);
    } catch (error) {
        logger.error(`[Get Delivery Area Categories Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "એરિયા કેટેગરી લાવવામાં ભૂલ આવી.", error.message);
    }
};

/**
 * @desc    Get assignable orders filtered by one or multiple selected Area Categories
 * @route   POST /api/delivery/orders/by-areas
 *          GET  /api/delivery/orders/by-areas?areaCategoryIds=id1,id2
 * @access  Private (Delivery Boy)
 */
export const getOrdersByAreaCategories = async (req, res) => {
    try {
        let areaCategoryIds = req.body?.areaCategoryIds || req.query?.areaCategoryIds || req.query?.['areaCategoryIds[]'];

        if (typeof areaCategoryIds === 'string') {
            try {
                if (areaCategoryIds.startsWith('[') && areaCategoryIds.endsWith(']')) {
                    areaCategoryIds = JSON.parse(areaCategoryIds);
                } else {
                    areaCategoryIds = areaCategoryIds.split(',').map(s => s.trim()).filter(Boolean);
                }
            } catch (_) {
                areaCategoryIds = areaCategoryIds.split(',').map(s => s.trim()).filter(Boolean);
            }
        }

        if (!Array.isArray(areaCategoryIds) || areaCategoryIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "કૃપા કરીને ઓછામાં ઓછો એક એરિયા સિલેક્ટ કરો (Please select at least one area category).");
        }

        // Clean & validate UUIDs
        const validAreaIds = areaCategoryIds.filter(id => /^[0-9a-fA-F-]{36}$/.test(String(id).trim()));
        if (validAreaIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "માન્ય એરિયા ID મળ્યા નથી (No valid area IDs provided).");
        }

        // Workflow statuses ready for pickup/assignment
        const requestedStatus = req.body.status || req.query.status;
        const validWorkflowStatuses = ['Pending', 'Packaging', 'Packed'];
        let statusFilter = validWorkflowStatuses;

        if (requestedStatus) {
            if (Array.isArray(requestedStatus)) {
                statusFilter = requestedStatus;
            } else if (requestedStatus === 'All') {
                statusFilter = validWorkflowStatuses;
            } else {
                statusFilter = [requestedStatus];
            }
        }

        // Match orders directly tagged with area OR whose user profile is tagged with area
        const orders = await Order.findAll({
            where: {
                orderStatus: { [Op.in]: statusFilter },
                [Op.or]: [
                    { routeCategoryId: { [Op.in]: validAreaIds } },
                    { '$user.routeCategoryId$': { [Op.in]: validAreaIds } }
                ]
            },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'routeCategoryId'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['shopName', 'shopNameAlt', 'shopAddress', 'city', 'area']
                        }
                    ]
                },
                {
                    model: RouteCategory,
                    as: 'routeCategory',
                    attributes: ['id', 'name', 'pincode']
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    required: false,
                    include: [
                        {
                            model: DeliveryBoy,
                            as: 'deliveryBoy',
                            attributes: ['id', 'name', 'phone']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // Structured response for the Flutter delivery app
        const formattedOrders = orders.map(order => {
            const shopName = order.user?.businessProfile?.shopName || order.customerName || order.user?.fullname || '-';
            const shopAddress = order.user?.businessProfile?.shopAddress || 
                (order.shippingAddress ? (typeof order.shippingAddress === 'string' ? order.shippingAddress : (order.shippingAddress.address || order.shippingAddress.city || '')) : '') || '-';
            const areaName = order.routeCategory?.name || '-';
            const isAssigned = !!(order.assignment && order.assignment.deliveryBoyId);

            return {
                id: order.id,
                orderId: order.orderId,
                customerName: order.user?.fullname || order.customerName,
                customerPhone: order.user?.number || order.customerNumber,
                shopName,
                shopAddress,
                areaName,
                routeCategoryId: order.routeCategoryId || order.user?.routeCategoryId,
                orderStatus: order.orderStatus,
                paymentMethod: order.paymentMethod,
                paymentStatus: order.paymentStatus,
                totalAmount: parseFloat(order.totalAmount || 0),
                payableAmount: parseFloat(order.payableAmount || order.totalAmount || order.grandTotal || 0),
                dueAmount: parseFloat(order.dueAmount || 0),
                isAssigned,
                assignedDeliveryBoy: isAssigned ? {
                    id: order.assignment.deliveryBoy?.id,
                    name: order.assignment.deliveryBoy?.name,
                    phone: order.assignment.deliveryBoy?.phone
                } : null,
                itemsCount: Array.isArray(order.items) ? order.items.length : 0,
                createdAt: order.createdAt
            };
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${formattedOrders.length} ઓર્ડર મળ્યા.`, {
            totalOrders: formattedOrders.length,
            selectedAreaCount: validAreaIds.length,
            orders: formattedOrders
        });
    } catch (error) {
        logger.error(`[Get Orders By Area Categories Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "ઓર્ડર લાવવામાં ભૂલ આવી (Error fetching orders by area).", error.message);
    }
};
