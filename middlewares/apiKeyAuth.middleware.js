import Vendor from '../models/superadmin-models/Vendor.js';
import { sendErrorResponse } from '../utils/response.util.js';
import HTTP_STATUS from '../constants/httpStatusCodes.js';

/**
 * Middleware to authenticate public API requests using x-api-key header.
 * Attaches the vendor object to the request for subsequent use.
 */
export const validateApiKey = async (req, res, next) => {
    try {
        const apiKey = req.headers['x-api-key'];

        if (!apiKey) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, 'API Key is missing. Please provide x-api-key in headers.');
        }

        const vendor = await Vendor.findOne({ where: { apiKey } });

        if (!vendor) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, 'Invalid API Key.');
        }

        if (vendor.status !== 'active') {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Vendor account is suspended or pending.');
        }

        // Attach vendor to request
        req.vendor = vendor;
        next();
    } catch (error) {
        console.error('[API Auth Error]:', error.message);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Internal Server Error during authentication.');
    }
};
