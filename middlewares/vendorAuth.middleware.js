import jwt from 'jsonwebtoken';
import Vendor from '../models/superadmin-models/Vendor.js';
import { sendErrorResponse } from '../utils/response.util.js';
import HTTP_STATUS from '../constants/httpStatusCodes.js';
import APP_MESSAGES from '../constants/messages.js';
import logger from '../logger/apiLogger.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Middleware to protect Vendor Admin routes.
 * Verifies 'vendor_jwt' cookie (separate from superadmin 'jwt' cookie).
 * Attaches the vendor instance to req.vendor for downstream controllers.
 */
export const protectVendor = async (req, res, next) => {
    let token;

    // 1. Try to get vendor token from 'vendor_jwt' HTTP-Only Cookie
    if (req.cookies && req.cookies.vendor_jwt) {
        token = req.cookies.vendor_jwt;
    }
    // 2. Fallback to Bearer Token in Authorization headers
    else if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_NO_TOKEN);
    }

    try {
        // Verify and decode the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const { id, role } = decoded;

        let currentVendor = null;

        if (role === 'agent') {
            const Agent = (await import('../models/vendoradmin-models/Agent.js')).default;
            const agent = await Agent.findByPk(id);
            if (!agent) {
                return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, 'Agent account not found.');
            }
            // Fetch the vendor the agent belongs to
            currentVendor = await Vendor.findByPk(agent.vendorId, {
                attributes: { exclude: ['password'] }
            });
            req.agent = agent; // Attach agent info for permission checks
        } else {
            // Assume role is 'vendor' or default
            currentVendor = await Vendor.findByPk(id, {
                attributes: { exclude: ['password'] }
            });
        }

        if (!currentVendor) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_USER_DELETED);
        }

        // Check if vendor is active
        if (currentVendor.status === 'suspended') {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Your vendor account has been suspended.');
        }

        // Attach vendor to request for use in controllers
        req.vendor = currentVendor;
        req.userRole = role || 'vendor';

        next();
    } catch (error) {
        logger.warn(`[Vendor Auth Middleware] Audit Failed: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_INVALID_TOKEN);
    }
};

/**
 * Middleware to check if a specific vendor-level product/module is enabled.
 * Must be used AFTER protectVendor middleware.
 * @param {string} moduleName - The key in Vendor.enabledModules (e.g., 'marketing', 'ads')
 */
export const checkModuleAccess = (moduleName) => {
    return (req, res, next) => {
        const vendor = req.vendor;
        if (!vendor || !vendor.enabledModules) {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Module subscription data not found for this vendor.');
        }

        // Check if the specific module is enabled
        if (vendor.enabledModules[moduleName] === false) {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, `The '${moduleName}' product/feature is not enabled in your current plan. Please contact support to upgrade.`);
        }

        next();
    };
};
