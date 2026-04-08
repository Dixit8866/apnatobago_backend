import HTTP_STATUS from '../constants/httpStatusCodes.js';
import { sendErrorResponse } from '../utils/response.util.js';
import logger from '../logger/apiLogger.js';

/**
 * Middleware to check if the current user has permission for a specific module and action.
 * Superadmins bypass this check.
 * 
 * @param {string} moduleKey - The key of the module (e.g., 'languages', 'volumes', 'categories_main')
 * @param {string} action - The action required (e.g., 'create', 'read', 'update', 'delete')
 */
export const requirePermission = (moduleKey, action) => {
    return (req, res, next) => {
        const user = req.user;

        // If no user is attached (should not happen if protect middleware is used first)
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Unauthorized access.");
        }

        // Superadmins bypass all permission checks
        if (user.role === 'superadmin') {
            return next();
        }

        // Check if the user is a staff member
        if (user.role === 'staff') {
            const userPermissions = user.permissions || {};
            const modulePerms = userPermissions[moduleKey];

            // If the module permissions exist and the specific action is true
            if (modulePerms && modulePerms[action] === true) {
                return next();
            } else {
                logger.warn(`[Permission Denied] Staff ${user.id} attempted to '${action}' on module '${moduleKey}'`);
                return sendErrorResponse(
                    res, 
                    HTTP_STATUS.FORBIDDEN, 
                    `Access Forbidden: You do not have permission to ${action} ${moduleKey.replace('_', ' ')}.`
                );
            }
        }

        // If company-admin or old admin, fallback to generic allow (or handle as needed)
        if (['admin', 'company-admin'].includes(user.role)) {
            return next();
        }

        // Default deny
        return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Access Forbidden: Role not permitted.");
    };
};
