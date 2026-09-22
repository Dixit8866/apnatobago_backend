import { getIO } from '../socket.js';
import logger from '../logger/apiLogger.js';
import { Order, User } from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Standardized Real-Time Socket Event Broadcaster
 * Handles real-time events for Orders across Admin, Godown, Area Route categories, and Delivery Boys.
 */

/**
 * Safely get the initialized io instance or null
 */
const safeGetIO = () => {
    try {
        return getIO();
    } catch (_) {
        return null;
    }
};

/**
 * Dynamically resolve active delivery notice for an order if missing from the current payload
 */
export const resolveActiveNoticeForOrder = async (order) => {
    if (!order) return null;
    const plain = typeof order.toJSON === 'function' ? order.toJSON() : { ...order };

    let notice = plain.deliveryNotice || plain.user?.deliveryNotice || plain.partyActiveNotice || null;
    if (!notice && plain.notes) {
        const clean = String(plain.notes).replace(/\[.*?\]\s*/g, '').trim();
        if (clean && !clean.includes('Adjustments:')) notice = clean;
    }

    if (!notice) {
        const uId = plain.userId || plain.user?.id;
        const phone = plain.customerNumber || plain.user?.number;
        const whereConditions = [];
        if (uId) whereConditions.push({ userId: uId });
        if (phone && String(phone).replace(/\D/g, '').length >= 7) {
            whereConditions.push({ customerNumber: phone });
        }

        if (whereConditions.length > 0) {
            try {
                // First check User model
                if (uId) {
                    const u = await User.findByPk(uId, { attributes: ['id', 'deliveryNotice'] });
                    if (u && u.deliveryNotice) {
                        notice = u.deliveryNotice;
                    }
                }

                // If still not found, check most recent non-cancelled order of this customer
                if (!notice) {
                    const pastOrder = await Order.findOne({
                        where: {
                            [Op.or]: whereConditions,
                            [Op.or]: [
                                { deliveryNotice: { [Op.ne]: null } },
                                { notes: { [Op.ne]: null } }
                            ],
                            orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
                        },
                        order: [['createdAt', 'DESC']],
                        attributes: ['id', 'deliveryNotice', 'notes']
                    });
                    if (pastOrder) {
                        notice = pastOrder.deliveryNotice || pastOrder.notes;
                        if (notice) {
                            notice = String(notice).replace(/\[.*?\]\s*/g, '').trim();
                            if (notice.includes('Adjustments:')) notice = null;
                        }
                    }
                }
            } catch (err) {
                logger.error(`[Error resolving active notice for socket]: ${err.message}`);
            }
        }
    }

    return notice || null;
};

/**
 * Extract clean, uniform order summary payload
 */
export const formatOrderSocketPayload = (order) => {
    if (!order) return {};
    
    // Safely parse or handle nested sequelize objects
    const plain = typeof order.toJSON === 'function' ? order.toJSON() : { ...order };
    const notice = plain.deliveryNotice || plain.user?.deliveryNotice || plain.partyActiveNotice || (plain.notes && !String(plain.notes).includes('Adjustments:') ? plain.notes : null) || null;
    
    return {
        id: plain.id,
        orderId: plain.orderId,
        orderStatus: plain.orderStatus,
        saleType: plain.saleType,
        totalAmount: plain.totalAmount,
        paidAmount: plain.paidAmount,
        dueAmount: plain.dueAmount,
        deliveryMode: plain.deliveryMode,
        deliveryRoundTiming: plain.deliveryRoundTiming,
        deliveryDate: plain.deliveryDate,
        godownId: plain.godownId,
        routeCategoryId: plain.routeCategoryId || plain.user?.routeCategoryId,
        deliveryNotice: notice,
        hasNotice: Boolean(notice),
        createdAt: plain.createdAt,
        user: plain.user ? {
            id: plain.user.id,
            fullname: plain.user.fullname,
            number: plain.user.number,
            city: plain.user.city,
            routeCategoryId: plain.user.routeCategoryId,
            deliveryNotice: plain.user.deliveryNotice || notice || null,
            businessProfile: plain.user.businessProfile ? {
                shopName: plain.user.businessProfile.shopName,
                shopAddress: plain.user.businessProfile.shopAddress,
                area: plain.user.businessProfile.area
            } : null
        } : null,
        assignment: plain.assignment ? {
            id: plain.assignment.id,
            status: plain.assignment.status,
            deliveryBoyId: plain.assignment.deliveryBoyId,
            deliveryBoy: plain.assignment.deliveryBoy ? {
                id: plain.assignment.deliveryBoy.id,
                name: plain.assignment.deliveryBoy.name,
                phone: plain.assignment.deliveryBoy.phone
            } : null
        } : null,
        creator: plain.creator ? {
            id: plain.creator.id,
            name: plain.creator.name,
            role: plain.creator.role
        } : null
    };
};

/**
 * 1. Broadcast New Order Placed (Pending)
 * Emits to:
 * - Admin room (`admin_orders`, `admin_notifications`)
 * - Godown room (`godown_${godownId}`)
 * - Area route room (`area_${routeCategoryId}`)
 */
export const broadcastOrderCreated = async (order) => {
    const io = safeGetIO();
    if (!io) return;

    try {
        const payload = formatOrderSocketPayload(order);
        if (!payload.deliveryNotice) {
            const dynamicNotice = await resolveActiveNoticeForOrder(order);
            if (dynamicNotice) {
                payload.deliveryNotice = dynamicNotice;
                payload.hasNotice = true;
                if (payload.user) payload.user.deliveryNotice = dynamicNotice;
            }
        }

        const eventData = {
            type: 'ORDER_CREATED',
            order: payload,
            timestamp: new Date().toISOString()
        };

        // 1. Notify all admin panels
        io.to('admin_orders').emit('order:created', eventData);
        io.to('admin_notifications').emit('new_admin_notification', {
            title: 'New Order Received',
            message: `Order #${payload.orderId} received for ₹${payload.totalAmount}`,
            order: payload
        });

        // 2. Notify Godown if assigned
        if (payload.godownId) {
            io.to(`godown_${payload.godownId}`).emit('order:created', eventData);
        }

        // 3. Notify Area Route (Riders looking at this route)
        if (payload.routeCategoryId) {
            io.to(`area_${payload.routeCategoryId}`).emit('order:area_status_update', {
                orderId: payload.orderId,
                id: payload.id,
                routeCategoryId: payload.routeCategoryId,
                oldStatus: null,
                newStatus: payload.orderStatus || 'Pending',
                order: payload,
                timestamp: new Date().toISOString()
            });
            io.to(`area_${payload.routeCategoryId}`).emit('order:created', eventData);
        }

        logger.info(`[Socket Broadcast] ORDER_CREATED emitted for Order #${payload.orderId}`);
    } catch (err) {
        logger.error(`[Socket Broadcast Error] broadcastOrderCreated: ${err.message}`);
    }
};

/**
 * 2. Broadcast Order Status Changed (e.g. Pending -> Packaging -> Packed -> Shipping -> Delivered)
 * Emits to:
 * - Admin room (`admin_orders`)
 * - Godown room (`godown_${godownId}`)
 * - Area route room (`area_${routeCategoryId}`)
 * - Targeted Rider room if assigned (`rider_${deliveryBoyId}`)
 */
export const broadcastOrderStatusChanged = async ({ order, oldStatus, newStatus, routeCategoryId, godownId, deliveryBoyId }) => {
    const io = safeGetIO();
    if (!io) return;

    try {
        const payload = formatOrderSocketPayload(order);
        if (!payload.deliveryNotice) {
            const dynamicNotice = await resolveActiveNoticeForOrder(order);
            if (dynamicNotice) {
                payload.deliveryNotice = dynamicNotice;
                payload.hasNotice = true;
                if (payload.user) payload.user.deliveryNotice = dynamicNotice;
            }
        }

        const effectiveRouteId = routeCategoryId || payload.routeCategoryId;
        const effectiveGodownId = godownId || payload.godownId;
        const effectiveRiderId = deliveryBoyId || payload.assignment?.deliveryBoyId;

        const eventData = {
            type: 'ORDER_STATUS_CHANGED',
            orderId: payload.orderId,
            id: payload.id,
            oldStatus,
            newStatus,
            routeCategoryId: effectiveRouteId,
            godownId: effectiveGodownId,
            deliveryBoyId: effectiveRiderId,
            order: payload,
            timestamp: new Date().toISOString()
        };

        // 1. Notify Admin Panel
        io.to('admin_orders').emit('order:status_changed', eventData);

        // 2. Notify Godown Panel
        if (effectiveGodownId) {
            io.to(`godown_${effectiveGodownId}`).emit('order:status_changed', eventData);
        }

        // 3. Notify Delivery Boys listening to the Route Area (e.g. "Varachha Route")
        if (effectiveRouteId) {
            io.to(`area_${effectiveRouteId}`).emit('order:area_status_update', eventData);
        }

        // 4. Notify Targeted Delivery Boy if assigned
        if (effectiveRiderId) {
            io.to(`rider_${effectiveRiderId}`).emit('order:status_changed', eventData);
        }

        logger.info(`[Socket Broadcast] ORDER_STATUS_CHANGED emitted: #${payload.orderId} from [${oldStatus}] to [${newStatus}] (hasNotice: ${payload.hasNotice})`);
    } catch (err) {
        logger.error(`[Socket Broadcast Error] broadcastOrderStatusChanged: ${err.message}`);
    }
};

/**
 * 3. Broadcast Order Assignment to Delivery Boy
 * Emits to:
 * - Admin room (`admin_orders`)
 * - Targeted Rider room (`rider_${deliveryBoyId}`)
 * - Area route room (`area_${routeCategoryId}`)
 */
export const broadcastOrderAssigned = async ({ order, assignment, deliveryBoyId, routeCategoryId }) => {
    const io = safeGetIO();
    if (!io) return;

    try {
        const payload = formatOrderSocketPayload(order);
        if (!payload.deliveryNotice) {
            const dynamicNotice = await resolveActiveNoticeForOrder(order);
            if (dynamicNotice) {
                payload.deliveryNotice = dynamicNotice;
                payload.hasNotice = true;
                if (payload.user) payload.user.deliveryNotice = dynamicNotice;
            }
        }

        const effectiveRiderId = deliveryBoyId || assignment?.deliveryBoyId || payload.assignment?.deliveryBoyId;
        const effectiveRouteId = routeCategoryId || payload.routeCategoryId;

        const eventData = {
            type: 'ORDER_ASSIGNED',
            orderId: payload.orderId,
            id: payload.id,
            deliveryBoyId: effectiveRiderId,
            assignment: assignment || payload.assignment,
            order: payload,
            timestamp: new Date().toISOString()
        };

        // 1. Notify Admin
        io.to('admin_orders').emit('order:assigned', eventData);

        // 2. Notify Targeted Delivery Boy (Appears in their 'Assigned' tab instantly with popup notice!)
        if (effectiveRiderId) {
            io.to(`rider_${effectiveRiderId}`).emit('order:assigned_to_me', eventData);
        }

        // 3. Update Area room so counts update for other riders in the same area
        if (effectiveRouteId) {
            io.to(`area_${effectiveRouteId}`).emit('order:area_status_update', {
                ...eventData,
                newStatus: payload.orderStatus
            });
        }

        logger.info(`[Socket Broadcast] ORDER_ASSIGNED emitted for Order #${payload.orderId} to Rider ${effectiveRiderId} (hasNotice: ${payload.hasNotice}, notice: ${payload.deliveryNotice})`);
    } catch (err) {
        logger.error(`[Socket Broadcast Error] broadcastOrderAssigned: ${err.message}`);
    }
};

/**
 * 4. Broadcast Order Delivered & Payment Settled
 */
export const broadcastOrderDelivered = async ({ order, deliveryBoyId }) => {
    const io = safeGetIO();
    if (!io) return;

    try {
        const payload = formatOrderSocketPayload(order);
        const eventData = {
            type: 'ORDER_DELIVERED',
            orderId: payload.orderId,
            id: payload.id,
            oldStatus: 'Shipping',
            newStatus: 'Delivered',
            deliveryBoyId,
            order: payload,
            timestamp: new Date().toISOString()
        };

        io.to('admin_orders').emit('order:status_changed', eventData);
        if (payload.godownId) {
            io.to(`godown_${payload.godownId}`).emit('order:status_changed', eventData);
        }
        if (deliveryBoyId) {
            io.to(`rider_${deliveryBoyId}`).emit('order:status_changed', eventData);
        }

        logger.info(`[Socket Broadcast] ORDER_DELIVERED emitted for Order #${payload.orderId}`);
    } catch (err) {
        logger.error(`[Socket Broadcast Error] broadcastOrderDelivered: ${err.message}`);
    }
};

