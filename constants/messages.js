/**
 * Standard Application Messages mapping
 * Used to avoid hardcoding strings in the controllers and middlewares.
 */
const APP_MESSAGES = {
    // General Messages
    SERVER_HEALTHY: 'Server is healthy and running smoothly',
    ROUTE_NOT_FOUND: 'The requested route was not found on this server',
    INTERNAL_SERVER_ERROR: 'An internal server error occurred',
    VALIDATION_ERROR: 'Validation failed for the request data',

    // Auth Messages
    USER_REGISTER_SUCCESS: 'Admin registered successfully',
    USER_ALREADY_EXISTS: 'An admin with this email already exists',
    INVALID_USER_DATA: 'Invalid admin data provided',
    LOGIN_SUCCESS: 'Admin logged in successfully',
    LOGOUT_SUCCESS: 'Admin logged out successfully',
    INVALID_CREDENTIALS: 'The email or password you entered is incorrect',
    USER_NOT_FOUND: 'Admin not found in the system',
    PROFILE_FETCHED: 'Admin profile fetched successfully',

    // Authorization & Token Messages
    UNAUTHORIZED_NO_TOKEN: 'You are not logged in! Please provide a token to access this route',
    UNAUTHORIZED_INVALID_TOKEN: 'Invalid session or token expired! Please log in again',
    UNAUTHORIZED_USER_DELETED: 'The user belonging to this token no longer exists',
    FORBIDDEN_ROLE: 'You do not have permission to perform this action',

    // Vendor Messages
    VENDOR_CREATED: 'Vendor created successfully',
    VENDOR_UPDATED: 'Vendor updated successfully',
    VENDOR_DELETED: 'Vendor deleted successfully',
    VENDOR_FETCHED: 'Vendor(s) fetched successfully',
    VENDOR_NOT_FOUND: 'Vendor not found',
    VENDOR_ALREADY_EXISTS: 'A vendor with this email or name already exists',
    VENDOR_SUSPENDED: 'Your vendor account has been suspended. Please contact support.',
};

export default APP_MESSAGES;
