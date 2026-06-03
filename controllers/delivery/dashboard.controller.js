import { Order, OrderAssignment, OrderPayment } from '../../models/index.js';
import { Op } from 'sequelize';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * Helper to get the start and end of the current day in Indian Standard Time (IST),
 * returned as UTC Date objects for database querying.
 */
export const getTodayRangeIST = () => {
    const now = new Date();
    const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
    
    const year = istTime.getUTCFullYear();
    const month = istTime.getUTCMonth();
    const date = istTime.getUTCDate();
    
    const istStart = new Date(Date.UTC(year, month, date, 0, 0, 0, 0));
    const todayStart = new Date(istStart.getTime() - (5.5 * 60 * 60 * 1000));
    
    const istEnd = new Date(Date.UTC(year, month, date, 23, 59, 59, 999));
    const todayEnd = new Date(istEnd.getTime() - (5.5 * 60 * 60 * 1000));
    
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

        // Define the date range for TODAY aligned to Indian Standard Time (IST) 00:00:00 to 23:59:59.999
        const { todayStart, todayEnd } = getTodayRangeIST();

        // 1. Total Assigned Orders Today (only count active pending/assigned orders)
        const assignedOrdersCount = await OrderAssignment.count({
            where: {
                deliveryBoyId,
                status: {
                    [Op.in]: ['Assigned', 'Pending']
                },
                assignedAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });

        // 2. Completed Orders Today
        const completedOrdersCount = await OrderAssignment.count({
            where: {
                deliveryBoyId,
                status: 'Completed',
                updatedAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });

        // 3. Cancelled Orders Today
        const cancelledOrdersCount = await OrderAssignment.count({
            where: {
                deliveryBoyId,
                status: 'Cancelled',
                updatedAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });

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