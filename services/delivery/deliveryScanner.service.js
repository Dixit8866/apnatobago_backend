import { Op } from 'sequelize';
import { 
    OrderAssignment, 
    Order, 
    User, 
    BusinessProfile, 
    DeliveryBoy 
} from '../../models/index.js';
import logger from '../../logger/apiLogger.js';
import { broadcastOrderStatusChanged, broadcastOrderAssigned } from '../socketEvent.service.js';

/**
 * ==============================================================================
 * DELIVERY SCANNER SERVICE
 * ==============================================================================
 * Handles barcode scanning, rider validation, assignment creation/reassignment,
 * and status transitions for delivery assignments.
 */

/**
 * Scan barcode and assign order to delivery boy
 */
export const scanAndAssignOrderService = async ({ orderId, deliveryBoyId, reqUser }) => {
    const targetBoyId = deliveryBoyId || reqUser?.id;

    if (!orderId) {
        return { badRequest: "ઓર્ડર ID જરૂરી છે (Order ID is required)." };
    }

    if (!targetBoyId) {
        return { badRequest: "ડિલિવરી બોય ID જરૂરી છે (Delivery Boy ID is required)." };
    }

    const cleanId = String(orderId).replace(/^[#\s]+|[#\s]+$/g, '').trim();

    // 1. Verify delivery boy exists and is active
    const boy = await DeliveryBoy.findByPk(targetBoyId);
    if (!boy) {
        return { notFound: "ડિલિવરી બોય મળ્યો નથી (Delivery boy not found)." };
    }
    if (boy.status && boy.status !== 'Active') {
        return { badRequest: `આ ડિલિવરી બોય ખાતું ${boy.status} છે.` };
    }

    // 2. Find order by UUID or orderId
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
    const orderWhere = isUuid
        ? { [Op.or]: [{ id: cleanId }, { orderId: cleanId }] }
        : { orderId: cleanId };

    const order = await Order.findOne({
        where: orderWhere,
        include: [
            {
                model: User,
                as: 'user',
                attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'fcmtoken'],
                include: [
                    {
                        model: BusinessProfile,
                        as: 'businessProfile',
                        attributes: ['shopName', 'shopNameAlt', 'shopAddress', 'city', 'area']
                    }
                ]
            }
        ]
    });

    if (!order) {
        return { notFound: `ઓર્ડર #${cleanId} સિસ્ટમમાં મળ્યો નથી.` };
    }

    const shopName = order.user?.businessProfile?.shopName || order.customerName || order.user?.fullname || '-';

    // 3. Validation checks
    if (['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'].includes(order.orderStatus)) {
        return { badRequest: `ઓર્ડર #${order.orderId} (${shopName}) કેન્સલ થયેલ છે, તેથી સોંપી શકાતો નથી.` };
    }

    if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(order.orderStatus)) {
        return { badRequest: `ઓર્ડર #${order.orderId} (${shopName}) પહેલેથી જ પૂર્ણ (${order.orderStatus}) થઈ ગયેલ છે.` };
    }

    const now = new Date();

    // 4. Check if order is already assigned
    let assignment = await OrderAssignment.findOne({
        where: { orderId: order.id },
        include: [
            {
                model: DeliveryBoy,
                as: 'deliveryBoy',
                attributes: ['id', 'name', 'phone']
            }
        ]
    });

    if (assignment && assignment.deliveryBoyId && (assignment.status === 'Assigned' || order.orderStatus === 'Shipping')) {
        const assignedBoyName = assignment.deliveryBoy?.name || 'અન્ય ડિલિવરી બોય';
        const isSameBoy = String(assignment.deliveryBoyId) === String(boy.id);

        if (isSameBoy) {
            return {
                conflict: true,
                message: `ઓર્ડર #${order.orderId} (${shopName}) પહેલેથી જ તમને (${boy.name}) સોંપાયેલ છે.`,
                data: {
                    alreadyAssigned: true,
                    orderId: order.orderId,
                    id: order.id,
                    orderStatus: order.orderStatus,
                    shopName,
                    customerNumber: order.customerNumber || order.user?.number,
                    grandTotal: order.payableAmount || order.totalAmount || order.grandTotal,
                    deliveryBoy: {
                        id: boy.id,
                        name: boy.name,
                        phone: boy.phone
                    },
                    assignmentId: assignment.id,
                    assignedAt: assignment.assignedAt
                }
            };
        }

        return {
            conflict: true,
            message: `આ ઓર્ડર #${order.orderId} (${shopName}) પહેલેથી જ ${assignedBoyName} ને સોંપાયેલ છે.`,
            data: {
                alreadyAssigned: true,
                orderId: order.orderId,
                id: order.id,
                shopName,
                orderStatus: order.orderStatus,
                assignedDeliveryBoy: {
                    id: assignment.deliveryBoyId,
                    name: assignedBoyName,
                    phone: assignment.deliveryBoy?.phone || ''
                },
                assignedAt: assignment.assignedAt
            }
        };
    }

    let isReassigned = false;
    if (assignment) {
        isReassigned = true;
        await assignment.update({
            deliveryBoyId: boy.id,
            status: 'Assigned',
            assignedAt: now
        });
    } else {
        assignment = await OrderAssignment.create({
            orderId: order.id,
            deliveryBoyId: boy.id,
            status: 'Assigned',
            assignedAt: now
        });
    }

    // 5. Update Order status to Shipping
    const previousStatus = order.orderStatus;
    order.orderStatus = 'Shipping';
    order.packagingAt = order.packagingAt || now;
    order.packedAt = order.packedAt || now;
    order.shippingAt = now;
    order.deliveredAt = null;
    await order.save();

    try {
        const freshOrder = await Order.findByPk(order.id, {
            include: [
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'city', 'routeCategoryId', 'deliveryNotice'] },
                { model: OrderAssignment, as: 'assignment', include: [{ model: DeliveryBoy, as: 'deliveryBoy' }] }
            ]
        });
        broadcastOrderAssigned({
            order: freshOrder || order,
            assignment,
            deliveryBoyId: boy.id,
            routeCategoryId: freshOrder?.routeCategoryId || freshOrder?.user?.routeCategoryId
        });
        broadcastOrderStatusChanged({
            order: freshOrder || order,
            oldStatus: previousStatus,
            newStatus: 'Shipping',
            routeCategoryId: freshOrder?.routeCategoryId || freshOrder?.user?.routeCategoryId,
            godownId: order.godownId,
            deliveryBoyId: boy.id
        });
    } catch (sErr) {
        logger.error(`[Socket Broadcast Error in scanAndAssignOrderService]: ${sErr.message}`);
    }

    logger.info(`[Scan and Assign Order]: Order #${order.orderId} assigned to delivery boy ${boy.name} (${boy.id}). Prev status: ${previousStatus}`);

    return {
        success: true,
        message: `ઓર્ડર #${order.orderId} (${shopName}) સફળતાપૂર્વક ${boy.name} ને સોંપાઈ ગયો છે અને રવાના (Shipping) થઈ ગયો છે.`,
        data: {
            orderId: order.orderId,
            id: order.id,
            orderStatus: order.orderStatus,
            previousStatus,
            shopName,
            customerNumber: order.customerNumber || order.user?.number,
            grandTotal: order.payableAmount || order.totalAmount || order.grandTotal,
            deliveryBoy: {
                id: boy.id,
                name: boy.name,
                phone: boy.phone
            },
            assignmentId: assignment.id,
            assignedAt: now,
            isReassigned
        }
    };
};

export default {
    scanAndAssignOrderService
};
