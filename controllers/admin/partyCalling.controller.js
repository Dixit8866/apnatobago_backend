import { Op } from 'sequelize';
import User from '../../models/user/User.js';
import PartyCalling from '../../models/user/PartyCalling.js';
import { BusinessProfile, RouteCategory, AppSettings, Order } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';

/**
 * Fetch daily calling list for parties (customers)
 * India timezone midnight-to-midnight (12 to 12) handling
 */
export const getDailyPartyCalls = async (req, res, next) => {
    try {
        const { page = 1, limit = 50, search = '', status = 'All', routeCategoryId, deliveryRoundTiming } = req.query;
        
        const limitVal = parseInt(limit, 10) || 50;
        const pageVal = parseInt(page, 10) || 1;

        // Get current date string in India timezone (YYYY-MM-DD)
        const todayDateStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());

        // Calculate start and end of today in India timezone (GMT+5:30)
        const todayStart = new Date(`${todayDateStr}T00:00:00+05:30`);
        const todayEnd = new Date(`${todayDateStr}T23:59:59.999+05:30`);

        // Build base search criteria
        const userWhere = {
            status: { [Op.ne]: 'Deleted' },
            deliveryRoundId: {
                [Op.and]: [
                    { [Op.ne]: null },
                    { [Op.ne]: '' },
                    { [Op.ne]: 'none' }
                ]
            }
        };

        if (search) {
            userWhere[Op.or] = [
                { fullname: { [Op.iLike]: `%${search}%` } },
                { number: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopName$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (routeCategoryId) {
            userWhere.routeCategoryId = routeCategoryId;
        }

        if (deliveryRoundTiming) {
            userWhere.deliveryRoundTiming = deliveryRoundTiming;
        }

        const include = [
            {
                model: BusinessProfile,
                as: 'businessProfile',
                attributes: ['id', 'shopName', 'shopAddress', 'postcode']
            },
            {
                model: RouteCategory,
                as: 'routeCategory',
                attributes: ['id', 'name', 'pincode']
            },
            {
                model: PartyCalling,
                as: 'calls',
                where: { callingDate: todayDateStr },
                required: false
            },
            {
                model: Order,
                as: 'orders',
                where: {
                    createdAt: {
                        [Op.gte]: todayStart,
                        [Op.lte]: todayEnd
                    },
                    orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
                },
                required: false
            }
        ];

        // Fetch all matching users (without offset/limit yet to compute accurate in-memory tab counts)
        const users = await User.findAll({
            where: userWhere,
            include,
            order: [
                ['fullname', 'ASC']
            ]
        });

        // Map users to resolve their daily calling status
        const mappedUsers = users.map(user => {
            const call = user.calls && user.calls[0];
            const hasOrderToday = user.orders && user.orders.length > 0;

            let resolvedStatus = 'Pending Call';
            if (hasOrderToday) {
                resolvedStatus = 'Order Complete';
            } else if (call) {
                resolvedStatus = call.status;
            }

            const resolvedNotes = call ? call.notes : '';
            const resolvedCalledAt = call ? call.calledAt : null;
            const resolvedFollowupDateTime = call ? call.followupDateTime : null;

            const userJson = user.toJSON();
            userJson.callingStatus = resolvedStatus;
            userJson.callingNotes = resolvedNotes;
            userJson.calledAt = resolvedCalledAt;
            userJson.followupDateTime = resolvedFollowupDateTime;

            delete userJson.calls; // Clean up response payload
            delete userJson.orders; // Clean up response payload
            return userJson;
        });

        // Calculate tab counts
        const tabCounts = {
            All: mappedUsers.length,
            'Pending Call': 0,
            'Re-Followup': 0,
            'order Coming': 0,
            'Note Order': 0,
            'Order Complete': 0
        };

        mappedUsers.forEach(u => {
            if (tabCounts[u.callingStatus] !== undefined) {
                tabCounts[u.callingStatus]++;
            }
        });

        // Filter by selected status tab
        const filteredUsers = status && status !== 'All'
            ? mappedUsers.filter(u => u.callingStatus === status)
            : mappedUsers;

        // Calculate route & timing counts for the currently selected status tab
        const routeCounts = {};
        const timingCounts = {};

        filteredUsers.forEach(u => {
            if (u.routeCategoryId) {
                routeCounts[u.routeCategoryId] = (routeCounts[u.routeCategoryId] || 0) + 1;
            }
            if (u.deliveryRoundTiming) {
                timingCounts[u.deliveryRoundTiming] = (timingCounts[u.deliveryRoundTiming] || 0) + 1;
            }
        });

        // Perform in-memory pagination
        const totalRecords = filteredUsers.length;
        const totalPages = Math.ceil(totalRecords / limitVal) || 1;
        const currentPage = Math.min(pageVal, totalPages);
        const offsetVal = (currentPage - 1) * limitVal;
        const paginatedRows = filteredUsers.slice(offsetVal, offsetVal + limitVal);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party calling list fetched successfully.', {
            rows: paginatedRows,
            totalRecords,
            totalPages,
            currentPage,
            tabCounts,
            routeCounts,
            timingCounts,
            today: todayDateStr
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Log or update call status for a customer (party)
 * Inserts or updates the daily Asia/Kolkata record
 */
export const logOrUpdateCall = async (req, res, next) => {
    try {
        const { userId, status, notes, followupDateTime } = req.body;
        if (!userId || !status) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'UserId and status are required.');
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');
        }

        // Get current date string in India timezone (YYYY-MM-DD)
        const todayDateStr = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());

        const finalFollowup = status === 'Re-Followup' ? (followupDateTime || null) : null;

        // Find or create today's call log
        let [callRecord, created] = await PartyCalling.findOrCreate({
            where: { userId, callingDate: todayDateStr },
            defaults: {
                userId,
                callingDate: todayDateStr,
                status,
                notes: notes || null,
                calledAt: new Date(),
                followupDateTime: finalFollowup
            }
        });

        if (!created) {
            // Update existing call log for today
            await callRecord.update({
                status,
                notes: notes !== undefined ? notes : callRecord.notes,
                calledAt: new Date(),
                followupDateTime: finalFollowup
            });
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Call logged successfully.', callRecord);
    } catch (error) {
        next(error);
    }
};
