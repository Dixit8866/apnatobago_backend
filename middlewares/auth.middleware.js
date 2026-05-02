import jwt from 'jsonwebtoken';
import Admin from '../models/superadmin-models/Admin.js';
import GodownStaff from '../models/superadmin-models/GodownStaff.js';
import DeliveryBoy from '../models/superadmin-models/DeliveryBoy.js';
import { sendErrorResponse } from '../utils/response.util.js';
import HTTP_STATUS from '../constants/httpStatusCodes.js';
import APP_MESSAGES from '../constants/messages.js';
import logger from '../logger/apiLogger.js';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Middleware to protect routes and verify JWT token safely via Cookies (or headers map fallback)
 */
export const protect = async (req, res, next) => {
    let token;

    // 1. Try to get token from HTTP-Only Cookies primarily (More Secure)
    if (req.cookies && req.cookies.apna_tobacco_admin) {
        token = req.cookies.apna_tobacco_admin;
    }
    // 2. Fallback to extracting it from Authorization Headers (Bearer) (Standard method)
    else if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        token = req.headers.authorization.split(' ')[1];
    }

    // If there is no token at all
    if (!token) {
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_NO_TOKEN);
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Get admin from the token database
        const currentAdmin = await Admin.findByPk(decoded.id, {
            attributes: { exclude: ['password'] }
        });

        if (!currentAdmin) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_USER_DELETED);
        }

        // Attach admin to req object for next controllers
        req.user = currentAdmin;

        next();
    } catch (error) {
        logger.warn(`[Auth Middleware] JWT Verify Failed: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_INVALID_TOKEN);
    }
};
/**
 * Middleware to restrict access to Admins only
 */
export const admin = (req, res, next) => {
    const allowedRoles = ['admin', 'superadmin', 'company-admin', 'staff'];

    if (req.user && allowedRoles.includes(req.user.role)) {
        next();
    } else {
        logger.warn(`[Auth Middleware] Access Forbidden for user ${req.user?.id} with role ${req.user?.role}`);
        return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, APP_MESSAGES.FORBIDDEN_ROLE);
    }
};

/**
 * Middleware to protect routes and verify JWT token specifically for Godown Staff
 */
export const protectGodownStaff = async (req, res, next) => {
    let token = req.cookies?.apna_tobacco_admin || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);

    if (!token) return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_NO_TOKEN);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const currentStaff = await GodownStaff.findByPk(decoded.id, { attributes: { exclude: ['password'] } });

        if (!currentStaff) return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_USER_DELETED);

        req.user = currentStaff;
        next();
    } catch (error) {
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_INVALID_TOKEN);
    }
};

/**
 * Middleware to restrict access to Godown Admins only
 */
export const godownAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'superadmin') {
        next();
    } else {
        return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Access Denied: Godown Admin only.");
    }
};

/**
 * Middleware to protect routes and verify JWT token specifically for Delivery Boys
 */
export const protectDeliveryBoy = async (req, res, next) => {
    let token = req.cookies?.apna_tobacco_admin || (req.headers.authorization?.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);

    if (!token) return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_NO_TOKEN);

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const currentBoy = await DeliveryBoy.findByPk(decoded.id, { attributes: { exclude: ['password'] } });

        if (!currentBoy) return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_USER_DELETED);

        if (currentBoy.status !== 'Active') {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Your account is inactive. Please contact admin.");
        }

        req.user = currentBoy;
        next();
    } catch (error) {
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_INVALID_TOKEN);
    }
};
