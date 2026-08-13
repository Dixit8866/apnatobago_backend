import { Op } from 'sequelize';
import ActivityLog from '../../models/superadmin-models/ActivityLog.js';
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
        const { search, module, action, startDate, endDate, userType } = req.query;
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
