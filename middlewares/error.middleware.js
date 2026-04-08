import HTTP_STATUS from '../constants/httpStatusCodes.js';
import APP_MESSAGES from '../constants/messages.js';
import { sendErrorResponse } from '../utils/response.util.js';
import logger from '../logger/apiLogger.js';

/**
 * Global Error Handler middleware to gracefully send error messages to clients
 * while logging actual errors in winston logs.
 */
const globalErrorHandler = (err, req, res, next) => {
    logger.error(`[Error] ${err.message || APP_MESSAGES.INTERNAL_SERVER_ERROR} - Path: ${req.originalUrl} - Stack: ${err.stack}`);

    const statusCode = err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
    const message = err.message || APP_MESSAGES.INTERNAL_SERVER_ERROR;

    return sendErrorResponse(
        res,
        statusCode,
        message,
        null, // details (errors array)
        err.stack // Sent only if dev mode
    );
};

export default globalErrorHandler;
