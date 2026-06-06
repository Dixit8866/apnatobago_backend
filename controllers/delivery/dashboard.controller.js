import { Order, OrderAssignment, OrderPayment } from '../../models/index.js';
import { Op as SeqOp } from 'sequelize';
// Op already imported above via SeqOp alias; keep this for compatibility
const Op = SeqOp;
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * Returns today's full calendar day range in IST (Indian Standard Time UTC+5:30),
 * as UTC Date objects for database querying.
 *
 * "Today" = the current calendar date in IST, from 00:00:00.000 IST to 23:59:59.999 IST.
 *
 * Example: If server time is 2026-06-06T05:00:00Z (Saturday 10:30 IST), returns:
 *   todayStart = 2026-06-05T18:30:00.000Z  (Saturday 00:00:00 IST)
 *   todayEnd   = 2026-06-06T18:29:59.999Z  (Saturday 23:59:59 IST)
 */
export const getTodayRangeIST = () => {
    const now = new Date();

    // Shift to IST to figure out the current IST calendar date
    const istNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

    const year  = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const date  = istNow.getUTCDate();

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 19800000 ms

    // IST midnight → UTC
    const todayStart = new Date(Date.UTC(year, month, date, 0,  0,  0,   0) - IST_OFFSET_MS);
    // IST 23:59:59.999 → UTC
    const todayEnd   = new Date(Date.UTC(year, month, date, 23, 59, 59, 999) - IST_OFFSET_MS);

    // ── DEBUG ────────────────────────────────────────────────────────────────
    const toIST = (d) => new Date(d.getTime() + IST_OFFSET_MS)
        .toISOString().replace('T', ' ').slice(0, 23) + ' IST';
    console.log('[DEBUG getTodayRangeIST] ─────────────────────────────────────');
    console.log('[DEBUG getTodayRangeIST] Server UTC now :', now.toISOString());
    console.log('[DEBUG getTodayRangeIST] IST now        :', toIST(now));
    console.log('[DEBUG getTodayRangeIST] todayStart IST :', toIST(todayStart), '← today 00:00:00');
    console.log('[DEBUG getTodayRangeIST] todayEnd   IST :', toIST(todayEnd),   '← today 23:59:59');
    console.log('[DEBUG getTodayRangeIST] todayStart UTC :', todayStart.toISOString());
    console.log('[DEBUG getTodayRangeIST] todayEnd   UTC :', todayEnd.toISOString());
    console.log('[DEBUG getTodayRangeIST] ─────────────────────────────────────');
    // ─────────────────────────────────────────────────────────────────────────

    return { todayStart, todayEnd };
};


/**
 * @desc    Get dashboard statistics and summaries for the logged-in delivery boy
 * @route   GET /api/delivery/dashboard
 * @access  Private (Delivery Boy Only)
 */
export const getDeliveryDashboardStats = async (req, res) => {
    try {
        const deliveryBoyId = req.user.id;
        const riderName = req.user.name;
        const riderPhone = req.user.phone;
        const riderProfileImage = req.user.profileImage;

        logger.info(`[Delivery Dashboard]: Fetching dashboard statistics for rider ${riderName} (${deliveryBoyId})`);
        console.log(`\n[DASHBOARD DEBUG] ========================================`);
        console.log(`[DASHBOARD DEBUG] Rider: ${riderName} | ID: ${deliveryBoyId}`);

        // Define the rolling 24-hour range
        const { todayStart, todayEnd } = getTodayRangeIST();

        // 1. Total Active (Pending/Assigned) Orders - ALL time, no date restriction
        //    (delivery boy needs to see ALL pending orders regardless of date)
        const assignedOrdersCount = await OrderAssignment.count({
            where: {
                deliveryBoyId,
                status: {
                    [Op.in]: ['Assigned', 'Pending']
                }
            },
            include: [{
                model: Order,
                as: 'order',
                required: true,
                where: {
                    orderStatus: {
                        [Op.notIn]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
                    }
                }
            }]
        });
        console.log(`[DASHBOARD DEBUG] assignedOrdersCount (all active) : ${assignedOrdersCount}`);

        // 2. DEBUG: Find exact rows matched as "Completed today"
        const IST_MS = 5.5 * 60 * 60 * 1000;
        const toISTStr = (d) => d ? new Date(new Date(d).getTime() + IST_MS).toISOString().replace('T',' ').slice(0,19)+' IST' : 'NULL';

        const completedRows = await OrderAssignment.findAll({
            where: {
                deliveryBoyId,
                [Op.or]: [
                    {
                        status: 'Completed',
                        updatedAt: { [Op.between]: [todayStart, todayEnd] }
                    },
                    {
                        '$order.orderStatus$': { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                        '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
                    }
                ]
            },
            include: [{ model: Order, as: 'order', required: true, attributes: ['id', 'orderId', 'orderStatus', 'updatedAt'] }],
            attributes: ['id', 'status', 'updatedAt', 'assignedAt'],
            subQuery: false
        });
        const completedOrdersCount = completedRows.length;
        console.log(`[DASHBOARD DEBUG] completedOrdersCount : ${completedOrdersCount}`);
        completedRows.forEach((row, i) => {
            console.log(
                `[DASHBOARD DEBUG COMPLETED][${i+1}]` +
                ` orderId=${row.order?.orderId || row.order?.id}` +
                ` | assignment.status=${row.status}` +
                ` | assignment.updatedAt=${toISTStr(row.updatedAt)}` +
                ` | order.orderStatus=${row.order?.orderStatus}` +
                ` | order.updatedAt=${toISTStr(row.order?.updatedAt)}` +
                ` | assignedAt=${toISTStr(row.assignedAt)}`
            );
        });

        // 3. DEBUG: Find exact rows matched as "Cancelled today"
        const cancelledRows = await OrderAssignment.findAll({
            where: {
                deliveryBoyId,
                [Op.or]: [
                    {
                        status: 'Cancelled',
                        updatedAt: { [Op.between]: [todayStart, todayEnd] }
                    },
                    {
                        '$order.orderStatus$': { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] },
                        '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
                    }
                ]
            },
            include: [{ model: Order, as: 'order', required: true, attributes: ['id', 'orderId', 'orderStatus', 'updatedAt'] }],
            attributes: ['id', 'status', 'updatedAt', 'assignedAt'],
            subQuery: false
        });
        const cancelledOrdersCount = cancelledRows.length;
        console.log(`[DASHBOARD DEBUG] cancelledOrdersCount : ${cancelledOrdersCount}`);
        cancelledRows.forEach((row, i) => {
            console.log(
                `[DASHBOARD DEBUG CANCELLED][${i+1}]` +
                ` orderId=${row.order?.orderId || row.order?.id}` +
                ` | assignment.status=${row.status}` +
                ` | assignment.updatedAt=${toISTStr(row.updatedAt)}` +
                ` | order.orderStatus=${row.order?.orderStatus}` +
                ` | order.updatedAt=${toISTStr(row.order?.updatedAt)}` +
                ` | assignedAt=${toISTStr(row.assignedAt)}`
            );
        });
        console.log(`[DASHBOARD DEBUG] ========================================\n`);

        // 4. Fetch all payment transactions received by this delivery boy today
        const todayPayments = await OrderPayment.findAll({
            where: {
                deliveryBoyId,
                createdAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });

        // Calculate payment metrics
        let cashCollected = 0;
        let onlineCollected = 0;
        let creditCollected = 0;
        let cashSubmitted = 0;

        todayPayments.forEach(payment => {
            const amount = parseFloat(payment.amount || 0);
            if (payment.paymentMethod === 'CASH') {
                cashCollected += amount;
                if (payment.isSubmitted) {
                    cashSubmitted += amount;
                }
            } else if (payment.paymentMethod === 'ONLINE') {
                onlineCollected += amount;
            } else if (payment.paymentMethod === 'CREDIT') {
                creditCollected += amount;
            }
        });

        // Collected Payment: Total CASH and ONLINE payment collected from customers today
        // (excluding credit as it represents unpaid outstanding bills)
        const collectedPayment = cashCollected + onlineCollected;

        // Total Submitted Payment: All ONLINE payments (directly deposited online) 
        // + CASH payments that have been marked as submitted/verified by admin
        const totalSubmittedPayment = onlineCollected + cashSubmitted;

        // Cash remaining in hand (needs to be handed over to admin)
        const cashRemainingInHand = cashCollected - cashSubmitted;

        const summary = {
            riderInfo: {
                id: deliveryBoyId,
                name: riderName,
                phone: riderPhone,
                profileImage: riderProfileImage
            },
            todaySummary: {
                assignedOrders: assignedOrdersCount,
                completedOrders: completedOrdersCount,
                cancelledOrders: cancelledOrdersCount,
                collectedPayment: parseFloat(collectedPayment.toFixed(2)),
                totalSubmittedPayment: parseFloat(totalSubmittedPayment.toFixed(2)),
                cashRemainingInHand: parseFloat(cashRemainingInHand.toFixed(2)),
                breakdown: {
                    cashCollected: parseFloat(cashCollected.toFixed(2)),
                    onlineCollected: parseFloat(onlineCollected.toFixed(2)),
                    creditCollected: parseFloat(creditCollected.toFixed(2)),
                    cashSubmitted: parseFloat(cashSubmitted.toFixed(2))
                }
            }
        };

        logger.info(`[Delivery Dashboard]: Stats fetched successfully for ${riderName}. Assigned: ${assignedOrdersCount}, Completed: ${completedOrdersCount}, Collected: ${collectedPayment}`);

        return sendSuccessResponse(
            res,
            HTTP_STATUS.OK,
            "Delivery boy dashboard statistics fetched successfully.",
            summary
        );
    } catch (error) {
        logger.error(`[Delivery Dashboard Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};