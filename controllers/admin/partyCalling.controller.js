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
        const { page = 1, limit = 50, search = '', status = 'All', routeCategoryId, deliveryRoundTiming, date, godownId } = req.query;

        const appSettings = await AppSettings.findOne();
        const schedules = appSettings?.deliveryRoundSchedules || [];
        const normalizedSchedules = schedules.map((round, index) => ({
            id: round.id || `round_${index + 1}`,
            time: round.time || `${round.start || ''} - ${round.end || ''}`,
            ...round
        }));
        
        const limitVal = parseInt(limit, 10) || 50;
        const pageVal = parseInt(page, 10) || 1;

        // Get date string in India timezone (YYYY-MM-DD). If date is provided, use it.
        const callingDateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).format(new Date());

        // Calculate start and end of selected date in India timezone (GMT+5:30)
        const todayStart = new Date(`${callingDateStr}T00:00:00+05:30`);
        const todayEnd = new Date(`${callingDateStr}T23:59:59.999+05:30`);

        // Build base search criteria
        const userWhere = {
            status: { [Op.ne]: 'Deleted' }
        };

        if (godownId) {
            userWhere.godownId = godownId;
        }

        if (search) {
            userWhere[Op.or] = [
                { fullname: { [Op.iLike]: `%${search}%` } },
                { number: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopNameAlt$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        const include = [
            {
                model: BusinessProfile,
                as: 'businessProfile',
                attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode', 'area']
            },
            {
                model: RouteCategory,
                as: 'routeCategory',
                attributes: ['id', 'name', 'pincode']
            },
            {
                model: PartyCalling,
                as: 'calls',
                where: { callingDate: callingDateStr },
                required: false
            },
            {
                model: Order,
                as: 'orders',
                where: {
                    [Op.or]: [
                        {
                            createdAt: {
                                [Op.gte]: todayStart,
                                [Op.lte]: todayEnd
                            }
                        },
                        {
                            deliveryDate: callingDateStr
                        }
                    ],
                    orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
                },
                required: false
            }
        ];

        // Fetch all matching users (without offset/limit yet to compute accurate in-memory tab counts) with their last order date
        const users = await User.findAll({
            where: userWhere,
            attributes: {
                include: [
                    [
                        User.sequelize.literal(`(
                            SELECT "createdAt"
                            FROM "orders" AS "order"
                            WHERE
                                "order"."userId" = "User".id
                                AND "order"."orderStatus" NOT IN ('Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel')
                                AND "order"."deletedAt" IS NULL
                            ORDER BY "order"."createdAt" DESC
                            LIMIT 1
                        )`),
                        'lastOrderDate'
                    ]
                ]
            },
            include,
            order: [
                ['fullname', 'ASC']
            ]
        });

        // Calculate 30-day inactivity threshold based on calendar date start
        const thirtyDaysAgo = new Date(todayStart.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Map users to resolve their daily calling status
        const mappedUsers = users.map(user => {
            const call = user.calls && user.calls[0];
            const hasOrderToday = user.orders && user.orders.length > 0;
            const lastOrderDate = user.getDataValue('lastOrderDate') ? new Date(user.getDataValue('lastOrderDate')) : null;
            const userCreatedAt = user.createdAt ? new Date(user.createdAt) : new Date();
            const isKycVerified = String(user.kycverification || '').toLowerCase() === 'verified';

            // R-KYC: Inactive >= 30 days and KYC is pending
            const isRkyc = (lastOrderDate && lastOrderDate < thirtyDaysAgo) || (!lastOrderDate && userCreatedAt < thirtyDaysAgo);

            let resolvedStatus = 'Pending Call';
            if (hasOrderToday) {
                // 4) Order Complete: Party has placed/completed an order today
                resolvedStatus = 'Order Complete';
            } else if (isRkyc && !isKycVerified) {
                // 3) Rekyc Call: Inactive >= 30 days and KYC is pending
                resolvedStatus = 'Rekyc Call';
            } else if (!lastOrderDate) {
                // 2) Refollowup Call: Non Order parties (never ordered)
                resolvedStatus = 'Refollowup Call';
            } else {
                // 1) Pending Call: Active ordering parties (Start Order / Daily Order) who have not ordered today
                resolvedStatus = 'Pending Call';
            }

            // If an admin manually logged a specific recognized status today and no order was placed:
            if (!hasOrderToday && call && ['Pending Call', 'Refollowup Call', 'Rekyc Call'].includes(call.status)) {
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

            // Normalize deliveryRoundTiming based on deliveryRoundId
            if (userJson.deliveryRoundId) {
                const matchedRound = normalizedSchedules.find(s => s.id === userJson.deliveryRoundId);
                if (matchedRound) {
                    userJson.deliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                }
            }

            delete userJson.calls; // Clean up response payload
            delete userJson.orders; // Clean up response payload
            return userJson;
        });

        // Compute tab counts in order: Pending Call, Refollowup Call, Rekyc Call, Order Complete, All
        const tabCounts = {
            'Pending Call': 0,
            'Refollowup Call': 0,
            'Rekyc Call': 0,
            'Order Complete': 0,
            All: 0,
        };

        mappedUsers.forEach(u => {
            const matchRoute = !routeCategoryId || u.routeCategoryId === routeCategoryId;
            const matchTiming = !deliveryRoundTiming || u.deliveryRoundTiming === deliveryRoundTiming;
            if (matchRoute && matchTiming) {
                tabCounts.All++;
                if (tabCounts[u.callingStatus] !== undefined) {
                    tabCounts[u.callingStatus]++;
                }
            }
        });

        // Compute route counts (filtered by status tab and deliveryRoundTiming, but NOT routeCategoryId)
        const routeCounts = {};
        mappedUsers.forEach(u => {
            const matchStatus = !status || status === 'All' || u.callingStatus === status;
            const matchTiming = !deliveryRoundTiming || u.deliveryRoundTiming === deliveryRoundTiming;
            if (matchStatus && matchTiming) {
                if (u.routeCategoryId) {
                    routeCounts[u.routeCategoryId] = (routeCounts[u.routeCategoryId] || 0) + 1;
                }
            }
        });

        // Compute timing counts (filtered by status tab and routeCategoryId, but NOT deliveryRoundTiming)
        const timingCounts = {};
        mappedUsers.forEach(u => {
            const matchStatus = !status || status === 'All' || u.callingStatus === status;
            const matchRoute = !routeCategoryId || u.routeCategoryId === routeCategoryId;
            if (matchStatus && matchRoute) {
                if (u.deliveryRoundTiming) {
                    timingCounts[u.deliveryRoundTiming] = (timingCounts[u.deliveryRoundTiming] || 0) + 1;
                }
            }
        });

        // Filter users to display (matching status, routeCategoryId, and deliveryRoundTiming)
        const filteredUsers = mappedUsers.filter(u => {
            const matchStatus = !status || status === 'All' || u.callingStatus === status;
            const matchRoute = !routeCategoryId || u.routeCategoryId === routeCategoryId;
            const matchTiming = !deliveryRoundTiming || u.deliveryRoundTiming === deliveryRoundTiming;
            return matchStatus && matchRoute && matchTiming;
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
            today: callingDateStr
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

        const finalFollowup = (status === 'Re-Followup' || status === 'Refollowup Call') ? (followupDateTime || null) : null;

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
