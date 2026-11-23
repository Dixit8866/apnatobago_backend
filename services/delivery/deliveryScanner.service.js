import { Op } from 'sequelize';
import {
    OrderAssignment,
    Order,
    User,
    BusinessProfile,
    DeliveryBoy,
    OrderPayment,
    SalesReturn,
    AdminNotification
} from '../../models/index.js';
import sequelize from '../../config/db.js';
import logger from '../../logger/apiLogger.js';
import { broadcastOrderStatusChanged, broadcastOrderAssigned, broadcastOrderReassigned } from '../socketEvent.service.js';
import { logActivity } from '../../helpers/activityLog.helper.js';
import { emitAdminNotification } from '../../socket.js';

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

const CANCELLED_STATUSES = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
const FINISHED_STATUSES = ['Delivered', 'Payment Collect', 'Payment Verify'];

/**
 * Scan the bill barcode and take the order over.
 * - Not assigned yet      → assigned to the scanning boy (same as scan-assign).
 * - Assigned to another   → moved from that boy to the scanning boy.
 * - Already yours         → 409 alreadyAssigned.
 * Refused when the order is cancelled / finished, or when the other boy has
 * already taken a payment or a return on it (that money / goods is with him).
 * Stock is not touched.
 *
 * @param {string} orderId              scanned text (order number like "1234" / "#1234" or order UUID)
 * @param {string} [fromDeliveryBoyId]  boy the app showed in its confirm popup; if the order has moved
 *                                      to someone else meanwhile, the takeover is refused (409)
 */
export const scanReassignOrderService = async ({ orderId, fromDeliveryBoyId, reqUser, reqMeta = {} }) => {
    const boy = reqUser?.id ? await DeliveryBoy.findByPk(reqUser.id) : null;
    if (!orderId) {
        return { badRequest: "ઓર્ડર ID જરૂરી છે (Order ID is required)." };
    }
    if (!boy) {
        return { notFound: "ડિલિવરી બોય મળ્યો નથી (Delivery boy not found)." };
    }
    if (boy.status && boy.status !== 'Active') {
        return { badRequest: `આ ડિલિવરી બોય ખાતું ${boy.status} છે.` };
    }

    const cleanId = String(orderId).replace(/^[#\s]+|[#\s]+$/g, '').trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
    const found = await Order.findOne({
        where: isUuid ? { [Op.or]: [{ id: cleanId }, { orderId: cleanId }] } : { orderId: cleanId },
        attributes: ['id'],
    });
    if (!found) {
        return { notFound: `ઓર્ડર #${cleanId} સિસ્ટમમાં મળ્યો નથી.` };
    }

    const now = new Date();
    const t = await sequelize.transaction();
    let result;
    try {
        // Lock the order so two boys scanning together can't both take it.
        const order = await Order.findByPk(found.id, { transaction: t, lock: t.LOCK.UPDATE });
        const party = await User.findByPk(order.userId, {
            attributes: ['id', 'fullname', 'number'],
            include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName'] }],
            transaction: t,
        });
        const shopName = party?.businessProfile?.shopName || order.customerName || party?.fullname || '-';
        const orderInfo = {
            orderId: order.orderId,
            id: order.id,
            orderStatus: order.orderStatus,
            shopName,
            customerNumber: order.customerNumber || party?.number,
            grandTotal: order.payableAmount || order.totalAmount || order.grandTotal,
        };

        if (CANCELLED_STATUSES.includes(order.orderStatus)) {
            await t.rollback();
            return { badRequest: `ઓર્ડર #${order.orderId} (${shopName}) કેન્સલ થયેલ છે, તેથી સોંપી શકાતો નથી.` };
        }
        if (FINISHED_STATUSES.includes(order.orderStatus)) {
            await t.rollback();
            return { badRequest: `ઓર્ડર #${order.orderId} (${shopName}) પહેલેથી જ પૂર્ણ (${order.orderStatus}) થઈ ગયેલ છે.` };
        }

        let assignment = await OrderAssignment.findOne({ where: { orderId: order.id }, transaction: t, lock: t.LOCK.UPDATE });
        const holdsIt = assignment && assignment.deliveryBoyId && ['Assigned', 'Pending'].includes(assignment.status);
        const oldBoyId = holdsIt ? assignment.deliveryBoyId : null;
        const oldBoy = oldBoyId ? await DeliveryBoy.findByPk(oldBoyId, { attributes: ['id', 'name', 'phone'], transaction: t }) : null;
        const oldBoyInfo = oldBoyId ? { id: oldBoyId, name: oldBoy?.name || 'અન્ય ડિલિવરી બોય', phone: oldBoy?.phone || '' } : null;

        if (oldBoyId && String(oldBoyId) === String(boy.id)) {
            await t.rollback();
            return {
                conflict: true,
                message: `ઓર્ડર #${order.orderId} (${shopName}) પહેલેથી જ તમને (${boy.name}) સોંપાયેલ છે.`,
                data: { alreadyAssigned: true, ...orderInfo, deliveryBoy: { id: boy.id, name: boy.name, phone: boy.phone }, assignmentId: assignment.id, assignedAt: assignment.assignedAt },
            };
        }

        // The app confirmed "take from X" but the order is now with someone else.
        if (fromDeliveryBoyId && String(fromDeliveryBoyId) !== String(oldBoyId || '')) {
            await t.rollback();
            return {
                conflict: true,
                message: oldBoyInfo
                    ? `ઓર્ડર #${order.orderId} (${shopName}) હવે ${oldBoyInfo.name} પાસે છે. ફરી સ્કેન કરો.`
                    : `ઓર્ડર #${order.orderId} (${shopName}) હવે કોઈને સોંપાયેલ નથી. ફરી સ્કેન કરો.`,
                data: { assignmentChanged: true, ...orderInfo, assignedDeliveryBoy: oldBoyInfo },
            };
        }

        // The other boy already took money / goods back on this order → admin must sort it out.
        if (oldBoyId) {
            const [paidCount, returnCount] = await Promise.all([
                OrderPayment.count({ where: { orderId: order.id, deliveryBoyId: oldBoyId }, transaction: t }),
                SalesReturn.count({ where: { orderId: order.id, deliveryBoyId: oldBoyId }, transaction: t }),
            ]);
            if (paidCount || returnCount) {
                await t.rollback();
                return {
                    conflict: true,
                    message: `ઓર્ડર #${order.orderId} (${shopName}) પર ${oldBoyInfo.name} એ ${paidCount ? 'પેમેન્ટ' : 'રિટર્ન'} લીધું છે, તેથી બીજાને સોંપી શકાતો નથી. એડમિનનો સંપર્ક કરો.`,
                    data: { blocked: true, reason: paidCount ? 'PAYMENT_TAKEN' : 'RETURN_TAKEN', ...orderInfo, assignedDeliveryBoy: oldBoyInfo },
                };
            }
        }

        // Put it at the end of the scanning boy's list.
        const lastPosition = await OrderAssignment.max('position', {
            where: { deliveryBoyId: boy.id, status: { [Op.in]: ['Pending', 'Assigned'] } },
            transaction: t,
        });
        const position = Number.isFinite(Number(lastPosition)) && lastPosition !== null ? Number(lastPosition) + 1 : 0;

        if (assignment) {
            await assignment.update({ deliveryBoyId: boy.id, status: 'Assigned', assignedAt: now, position }, { transaction: t });
        } else {
            assignment = await OrderAssignment.create({ orderId: order.id, deliveryBoyId: boy.id, status: 'Assigned', assignedAt: now, position }, { transaction: t });
        }

        const previousStatus = order.orderStatus;
        order.orderStatus = 'Shipping';
        order.packagingAt = order.packagingAt || now;
        order.packedAt = order.packedAt || now;
        order.shippingAt = now;
        order.deliveredAt = null;
        await order.save({ transaction: t });

        await t.commit();
        result = { order, assignment, previousStatus, shopName, orderInfo, oldBoyInfo };
    } catch (err) {
        if (!t.finished) await t.rollback();
        throw err;
    }

    const { order, assignment, previousStatus, shopName, orderInfo, oldBoyInfo } = result;
    const fromText = oldBoyInfo ? `${oldBoyInfo.name} પાસેથી ` : '';

    // Activity log + admin notification + sockets (never fail the takeover because of these).
    await logActivity(
        { user: { id: boy.id, name: boy.name, role: 'Delivery Boy', userType: 'DeliveryBoy' }, ...reqMeta },
        {
            module: 'Delivery',
            action: oldBoyInfo ? 'REASSIGN' : 'ASSIGN',
            description: oldBoyInfo
                ? `Order #${order.orderId} moved from ${oldBoyInfo.name} to ${boy.name} by bill scan.`
                : `Order #${order.orderId} assigned to ${boy.name} by bill scan.`,
            metadata: { orderId: order.id, fromDeliveryBoyId: oldBoyInfo?.id || null, toDeliveryBoyId: boy.id, previousStatus },
        }
    );
    if (oldBoyInfo) {
        try {
            const adminNotify = await AdminNotification.create({
                title: 'Order Reassigned',
                message: `Order #${order.orderId} (${shopName}) moved from ${oldBoyInfo.name} to ${boy.name} by bill scan.`,
                type: 'ORDER_REASSIGN',
                referenceId: order.id,
                clickAction: '/sales/user-orders',
            });
            emitAdminNotification(adminNotify);
        } catch (nErr) {
            logger.error(`[Admin Notification Error in scanReassignOrderService]: ${nErr.message}`);
        }
    }
    try {
        const freshOrder = await Order.findByPk(order.id, {
            include: [
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'city', 'routeCategoryId', 'deliveryNotice'] },
                { model: OrderAssignment, as: 'assignment', include: [{ model: DeliveryBoy, as: 'deliveryBoy' }] }
            ]
        });
        const routeCategoryId = freshOrder?.routeCategoryId || freshOrder?.user?.routeCategoryId;
        await broadcastOrderAssigned({ order: freshOrder || order, assignment, deliveryBoyId: boy.id, routeCategoryId });
        if (oldBoyInfo) {
            await broadcastOrderReassigned({
                order: freshOrder || order,
                fromDeliveryBoyId: oldBoyInfo.id,
                toDeliveryBoy: { id: boy.id, name: boy.name, phone: boy.phone },
                routeCategoryId,
            });
        }
        if (previousStatus !== 'Shipping') {
            await broadcastOrderStatusChanged({
                order: freshOrder || order,
                oldStatus: previousStatus,
                newStatus: 'Shipping',
                routeCategoryId,
                godownId: order.godownId,
                deliveryBoyId: boy.id
            });
        }
    } catch (sErr) {
        logger.error(`[Socket Broadcast Error in scanReassignOrderService]: ${sErr.message}`);
    }

    logger.info(`[Scan Reassign Order]: Order #${order.orderId} → ${boy.name} (${boy.id})${oldBoyInfo ? ` from ${oldBoyInfo.name} (${oldBoyInfo.id})` : ''}. Prev status: ${previousStatus}`);

    return {
        success: true,
        message: `ઓર્ડર #${order.orderId} (${shopName}) ${fromText}તમને (${boy.name}) સોંપાઈ ગયો છે.`,
        data: {
            ...orderInfo,
            orderStatus: order.orderStatus,
            previousStatus,
            deliveryBoy: { id: boy.id, name: boy.name, phone: boy.phone },
            previousDeliveryBoy: oldBoyInfo,
            isReassigned: Boolean(oldBoyInfo),
            assignmentId: assignment.id,
            assignedAt: now,
        }
    };
};

export default {
    scanAndAssignOrderService,
    scanReassignOrderService
};
