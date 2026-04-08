/**
 * Utility for sending standard Success Responses
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - A descriptive success message
 * @param {Object} data - Resulting data payload
 */
export const sendSuccessResponse = (res, statusCode, message, data = null) => {
    const response = {
        success: true,
        message,
    };

    if (data) {
        response.data = data;
    }

    return res.status(statusCode).json(response);
};

/**
 * Utility for sending standard Error Responses
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Detailed error message
 * @param {Object|Array} errors - Additional validation errors or details
 * @param {string|null} stack - Error stack trace (usually only in development)
 */
export const sendErrorResponse = (res, statusCode, message, errors = null, stack = null) => {
    const response = {
        success: false,
        message,
    };

    if (errors) {
        response.errors = errors;
    }

    if (stack && process.env.NODE_ENV === 'development') {
        response.stack = stack;
    }

    return res.status(statusCode).json(response);
};
