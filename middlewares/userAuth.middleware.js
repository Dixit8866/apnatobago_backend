import jwt from 'jsonwebtoken';
import User from '../models/user/User.js';
import { sendErrorResponse } from '../utils/response.util.js';
import HTTP_STATUS from '../constants/httpStatusCodes.js';
import APP_MESSAGES from '../constants/messages.js';
import logger from '../logger/apiLogger.js';
import dotenv from 'dotenv';
dotenv.config();

export const protectUser = async (req, res, next) => {
    let token;

    if (req.cookies && req.cookies.jwt) {
        token = req.cookies.jwt;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_NO_TOKEN);
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const currentUser = await User.findByPk(decoded.id, {
            attributes: { exclude: ['password'] }
        });

        if (!currentUser) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_USER_DELETED);
        }

        if (currentUser.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "User account is deleted.");
        }
        
        if (currentUser.logintoken !== token) {
             return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Session expired, logged in from another device or logged out.");
        }

        req.user = currentUser;
        next();
    } catch (error) {
        logger.warn(`[User Auth Middleware] JWT Verify Failed: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.UNAUTHORIZED_INVALID_TOKEN);
    }
};
