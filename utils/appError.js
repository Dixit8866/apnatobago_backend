/**
 * Custom Error class designed to represent operational errors.
 * Instead of throwing a generic Error, use AppError to easily assign a status code and formatting.
 */
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // Indicates it is an expected application error

        // Capture stack trace, excluding constructor call from it
        Error.captureStackTrace(this, this.constructor);
    }
}

export default AppError;
