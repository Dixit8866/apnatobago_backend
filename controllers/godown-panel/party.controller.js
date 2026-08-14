import { Op } from 'sequelize';
import { User, BusinessProfile, Godown, RouteCategory, AppSettings } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

// Safe attributes list to match admin panel
const SAFE_ATTRIBUTES = ['id', 'fullname', 'email', 'dialcode', 'number', 'city', 'postcode', 'showtabacco', 'creditline', 'blockcredit', 'applevel', 'status', 'kycverification', 'routeCategoryId', 'deliveryRoundId', 'deliveryRoundTiming', 'deviceType', 'version', 'latitude', 'longitude', 'createdAt', 'updatedAt'];

/**
 * @desc    Get parties assigned to this godown
 * @route   GET /api/godown-panel/parties
 * @access  Private (GodownStaff)
 */
export const getGodownParties = async (req, res, next) => {
    try {
        const staff = req.user;
        const { page = 1, limit = 50, search = '', status, kycverification, routeCategoryId, deliveryRoundTiming } = req.query;
        const { limit: limitOptions, offset } = getPaginationOptions(req.query);

        const searchWhere = {
            godownId: staff.godownId,
        };

        if (search) {
            searchWhere[Op.or] = [
                { fullname: { [Op.iLike]: `%${search}%` } },
                { number: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopNameAlt$': { [Op.iLike]: `%${search}%` } }
            ];
        }

        if (kycverification) searchWhere.kycverification = kycverification;
        if (routeCategoryId) searchWhere.routeCategoryId = routeCategoryId;
        if (deliveryRoundTiming) searchWhere.deliveryRoundTiming = deliveryRoundTiming;

        const where = { ...searchWhere };
        if (status) where.status = status;

        const include = [
            {
                model: BusinessProfile,
                as: 'businessProfile',
                attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
            },
            {
                model: RouteCategory,
                as: 'routeCategory',
                attributes: ['id', 'name', 'pincode']
            },
            {
                model: Godown,
                as: 'assignedGodown',
                attributes: ['id', 'name']
            }
        ];

        // Parallel status counts (search and KYC aware, not status-filtered)
        const [totalCount, activeCount, inactiveCount, deletedCount] = await Promise.all([
            User.count({ where: searchWhere, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Active' }, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Inactive' }, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Deleted' }, include, distinct: true }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        // Calculate user counts by routeCategory
        const routeCountWhere = { ...where };
        delete routeCountWhere.routeCategoryId;
        routeCountWhere.routeCategoryId = { [Op.ne]: null };

        const routeCountsRaw = await User.count({
            where: routeCountWhere,
            include,
            distinct: true,
            group: ['routeCategoryId']
        });

        const routeCounts = {};
        if (Array.isArray(routeCountsRaw)) {
            routeCountsRaw.forEach(r => {
                const id = r.routeCategoryId;
                if (id) {
                    routeCounts[id] = parseInt(r.count || 0, 10);
                }
            });
        }

        // Calculate user counts by deliveryRoundTiming
        const timingCountWhere = { ...where };
        delete timingCountWhere.deliveryRoundTiming;
        timingCountWhere.deliveryRoundTiming = { [Op.ne]: null };

        const timingCountsRaw = await User.count({
            where: timingCountWhere,
            include,
            distinct: true,
            group: ['deliveryRoundTiming']
        });

        const timingCounts = {};
        if (Array.isArray(timingCountsRaw)) {
            timingCountsRaw.forEach(r => {
                const timing = r.deliveryRoundTiming;
                if (timing) {
                    timingCounts[timing] = parseInt(r.count || 0, 10);
                }
            });
        }

        if (req.query.paginate === 'false') {
            const users = await User.findAll({ 
                where, 
                attributes: SAFE_ATTRIBUTES, 
                include,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Parties fetched successfully.', users);
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            attributes: SAFE_ATTRIBUTES,
            include,
            limit: limitOptions,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const responseData = formatPaginatedResponse({ count, rows }, page, limitOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Parties fetched successfully.', {
            ...responseData,
            statusCounts,
            routeCounts,
            timingCounts
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get a single party detail
 * @route   GET /api/godown-panel/parties/:id
 * @access  Private (GodownStaff)
 */
export const getGodownPartyById = async (req, res, next) => {
    try {
        const staff = req.user;
        const { id } = req.params;

        const user = await User.findOne({
            where: {
                id,
                godownId: staff.godownId,
            },
            include: [
                { model: BusinessProfile, as: 'businessProfile', required: false },
                { model: Godown, as: 'assignedGodown', attributes: ['id', 'name'], required: false },
            ],
        });

        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Party not found or not assigned to your godown');

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party fetched', user);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update a party status or fields
 * @route   PATCH /api/godown-panel/parties/:id
 * @access  Private (GodownStaff)
 */
export const updateGodownParty = async (req, res, next) => {
    try {
        const staff = req.user;
        const { id } = req.params;
        const { showtabacco, blockcredit, kycverification, status } = req.body;

        const user = await User.findOne({
            where: {
                id,
                godownId: staff.godownId,
            }
        });

        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Party not found or not assigned to your godown');
        }

        const updates = {};
        if (showtabacco !== undefined) updates.showtabacco = showtabacco;
        if (blockcredit !== undefined) updates.blockcredit = blockcredit;
        if (kycverification !== undefined) updates.kycverification = kycverification;
        if (status !== undefined) updates.status = status;

        await user.update(updates);

        logActivity(req, {
            module: 'Party Management',
            action: 'UPDATE',
            description: `Updated party "${user.fullname}" details`,
            metadata: { partyId: user.id, updates }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party updated successfully.', user);
    } catch (error) {
        next(error);
    }
};
