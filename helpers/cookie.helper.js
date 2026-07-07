/**
 * Helper to attach JWT token to HTTP-Only Cookie
 * @param {Object} res - Express response object
 * @param {string} token - JWT Token to attach
 * @param {string} name - Name of the cookie
 */
export const setTokenCookie = (res, token, name = 'apna_tobacco_admin') => {
    const cookieOptions = {
        httpOnly: true, // Prevents client-side JS from reading the cookie
        secure: process.env.NODE_ENV === 'production', // Cookie is only sent over HTTPS in production
        sameSite: 'strict', // Protects against CSRF attacks
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 Days in milliseconds
    };

    res.cookie(name, token, cookieOptions);
};

/**
 * Helper to clear JWT token cookie (for Logout)
 * @param {Object} res - Express response object
 * @param {string} name - Name of the cookie
 */
export const clearTokenCookie = (res, name = 'apna_tobacco_admin') => {
    res.cookie(name, '', {
        httpOnly: true,
        expires: new Date(0), // Expire the cookie immediately
    });
};
