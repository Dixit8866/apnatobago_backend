import ActivityLog from '../models/superadmin-models/ActivityLog.js';
import logger from '../logger/apiLogger.js';

/**
 * Log user/admin activity asynchronously to ActivityLog table
 * 
 * @param {Object} req - Express request object
 * @param {Object} options
 * @param {string} options.module - Module name (e.g. 'Order List', 'Custom Sales', 'Products', 'Purchase Bill', 'Order Received Bill', 'Stock Inventory', 'Users', 'Vendors')
 * @param {string} options.action - Action type ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'PAYMENT', 'STOCK_UPDATE')
 * @param {string} options.description - Human readable description of action performed
 * @param {Object} [options.metadata] - Extra metadata, snapshots, changed values, IDs
 */
export const logActivity = async (req, { module, action, description, metadata = {} }) => {
    try {
        const currentUser = req?.user || req?.admin || req?.staff || {};
        const userId = currentUser.id || null;
        const userName = currentUser.name || currentUser.username || currentUser.email || 'Admin User';
        const userRole = currentUser.role?.name || currentUser.role || (currentUser.isSuperAdmin ? 'Super Admin' : 'Admin Staff');
        const userType = currentUser.userType || (currentUser.isSuperAdmin ? 'Super Admin' : 'Admin');

        const ipAddress = req?.headers?.['x-forwarded-for'] || req?.socket?.remoteAddress || req?.ip || '';

        await ActivityLog.create({
            userId,
            userType,
            userName,
            userRole,
            module,
            action,
            description,
            metadata,
            ipAddress
        });
    } catch (error) {
        logger.error(`[ActivityLog Error]: Failed to create activity log: ${error.message}`);
    }
};
