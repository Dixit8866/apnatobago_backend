import { Op } from 'sequelize';
import ActivityLog from '../../models/superadmin-models/ActivityLog.js';
import { Admin, GodownStaff, DeliveryBoy } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

const AVAILABLE_MODULES = [
    'Party / Users',
    'Daily Calling',
    'Inactive Party',
    'User Order List',
    'Order History',
    'Custom Sales',
    'Vendor Order List',
    'Purchase Bill',
    'Order Received Bill',
    'Customer Payments',
    'Vendor Payments',
    'Bank Add',
    'Bank History',
    'Main Category',
    'Sub Category',
    'Company Category',
    'Route Category',
    'Volumes',
    'Products',
    'Inventory Overview',
    'Stock Logs',
    'Report',
    'Delivery Management',
    'Vendors',
    'Staff Access',
    'Staff Roles',
    'Godown List',
    'Godown Staff',
    'Stock Transfers',
    'Help & Support',
    'App Settings',
    'Emergency Lock',
    'Banner',
    'Offers',
    'Add Custom Level',
    'Language',
    'Notifications'
];

/**
 * @desc    Get all activity logs for software monitoring with filters & pagination
 * @route   GET /api/admin/activity-logs
 * @access  Private (Admin)
 */
export const getActivityLogs = async (req, res) => {
    try {
        const { search, module, action, startDate, endDate, userType, userId, staff } = req.query;
        const { limit, offset, page } = getPaginationOptions(req.query);

        const where = {};

        if (module && module !== 'ALL') {
            if (module === 'Purchase Bill' || module === 'Order Received Bill') {
                where.module = { [Op.in]: ['Purchase Bill', 'Order Received Bill'] };
            } else if (module === 'Products' || module === 'Product') {
                where.module = { [Op.in]: ['Products', 'Product'] };
            } else if (module === 'User Order List' || module === 'Order List') {
                where.module = { [Op.in]: ['User Order List', 'Order List'] };
            } else {
                where.module = module;
            }
        }

        if (action && action !== 'ALL') {
            where.action = action;
        }

        if (userType && userType !== 'ALL') {
            where.userType = userType;
        }

        if (userId && userId !== 'ALL') {
            where.userId = userId;
        } else if (staff && staff !== 'ALL') {
            where[Op.or] = [
                { userId: staff },
                { userName: staff }
            ];
        }

        if (startDate || endDate) {
            where.createdAt = {};
            if (startDate) {
                where.createdAt[Op.gte] = new Date(startDate);
            }
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                where.createdAt[Op.lte] = end;
            }
        }

        if (search) {
            const searchPattern = `%${search.trim()}%`;
            where[Op.or] = [
                { description: { [Op.iLike]: searchPattern } },
                { userName: { [Op.iLike]: searchPattern } },
                { userRole: { [Op.iLike]: searchPattern } },
                { module: { [Op.iLike]: searchPattern } },
                { action: { [Op.iLike]: searchPattern } }
            ];
        }

        const result = await ActivityLog.findAndCountAll({
            where,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const paginated = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Activity logs fetched successfully', paginated);
    } catch (error) {
        logger.error(`[Get Activity Logs Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get available modules list for filter dropdown
 * @route   GET /api/admin/activity-logs/modules
 * @access  Private (Admin)
 */
export const getActivityLogModules = async (req, res) => {
    try {
        const dbModules = await ActivityLog.findAll({
            attributes: ['module'],
            group: ['module'],
            raw: true
        });

        const loggedModules = dbModules.map(m => m.module).filter(Boolean);
        const combined = Array.from(new Set([...AVAILABLE_MODULES, ...loggedModules]));

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Available modules fetched', combined);
    } catch (error) {
        logger.error(`[Get Activity Log Modules Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get summary statistics for Software Monitoring dashboard
 * @route   GET /api/admin/activity-logs/stats
 * @access  Private (Admin)
 */
export const getActivityLogStats = async (req, res) => {
    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [totalLogs, todayLogs, totalCreates, totalUpdates, totalDeletes] = await Promise.all([
            ActivityLog.count(),
            ActivityLog.count({ where: { createdAt: { [Op.gte]: todayStart } } }),
            ActivityLog.count({ where: { action: 'CREATE' } }),
            ActivityLog.count({ where: { action: 'UPDATE' } }),
            ActivityLog.count({ where: { action: 'DELETE' } })
        ]);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Activity log stats fetched', {
            totalLogs,
            todayLogs,
            totalCreates,
            totalUpdates,
            totalDeletes
        });
    } catch (error) {
        logger.error(`[Get Activity Log Stats Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get list of unique users/staff who have logged activity or exist in database
 * @route   GET /api/admin/activity-logs/users
 * @access  Private (Admin)
 */
export const getActivityLogUsers = async (req, res) => {
    try {
        const [admins, staffMembers, deliveryBoys, loggedUsers] = await Promise.all([
            Admin.findAll({ attributes: ['id', 'name', 'username', 'role'], raw: true }),
            GodownStaff.findAll({ attributes: ['id', 'name', 'username', 'role'], raw: true }),
            DeliveryBoy.findAll({ attributes: ['id', 'name', 'phone'], raw: true }),
            ActivityLog.findAll({
                attributes: ['userId', 'userName', 'userRole', 'userType'],
                group: ['userId', 'userName', 'userRole', 'userType'],
                raw: true
            })
        ]);

        const combinedMap = new Map();

        // 1. Add all Admins
        admins.forEach(a => {
            const label = a.name || a.username || 'Admin';
            combinedMap.set(String(a.id), {
                userId: String(a.id),
                userName: label,
                userRole: a.role || 'Admin',
                userType: 'Admin'
            });
        });

        // 2. Add all Godown Staff
        staffMembers.forEach(s => {
            const label = s.name || s.username || 'Godown Staff';
            combinedMap.set(String(s.id), {
                userId: String(s.id),
                userName: label,
                userRole: s.role || 'GodownStaff',
                userType: 'GodownStaff'
            });
        });

        // 3. Add all Delivery Boys
        deliveryBoys.forEach(d => {
            const label = d.name || d.phone || 'Delivery Boy';
            combinedMap.set(String(d.id), {
                userId: String(d.id),
                userName: label,
                userRole: 'DeliveryBoy',
                userType: 'DeliveryBoy'
            });
        });

        // 4. Add any logged users from ActivityLog table not already present
        loggedUsers.forEach(u => {
            const key = u.userId ? String(u.userId) : String(u.userName);
            if (key && !combinedMap.has(key)) {
                combinedMap.set(key, {
                    userId: u.userId || key,
                    userName: u.userName || key,
                    userRole: u.userRole || 'Staff',
                    userType: u.userType || 'Staff'
                });
            }
        });

        const usersList = Array.from(combinedMap.values()).sort((a, b) => a.userName.localeCompare(b.userName));

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Activity log users fetched', usersList);
    } catch (error) {
        logger.error(`[Get Activity Log Users Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
