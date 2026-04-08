import Admin from '../../models/superadmin-models/Admin.js';
import { generateToken } from '../../helpers/jwt.helper.js';
import { setTokenCookie, clearTokenCookie } from '../../helpers/cookie.helper.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';

/**
 * @desc    Register a new admin
 * @route   POST /api/auth/register
 * @access  Public
 */
export const registerAdmin = async (req, res, next) => {
    try {
        const { name, email, password } = req.body;

        // Check if admin already exists
        const adminExists = await Admin.findOne({ where: { email } });

        if (adminExists) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, APP_MESSAGES.USER_ALREADY_EXISTS);
        }

        // Create admin
        const admin = await Admin.create({
            name,
            email,
            password,
        });

        if (admin) {
            const token = generateToken(admin.id);

            // Set token securely in HTTP-Only Cookie
            setTokenCookie(res, token);

            return sendSuccessResponse(res, HTTP_STATUS.CREATED, APP_MESSAGES.USER_REGISTER_SUCCESS, {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                token, // Optionally return token in body too (if desired for older apps)
            });
        } else {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, APP_MESSAGES.INVALID_USER_DATA);
        }
    } catch (error) {
        next(error); // Pass back to error middleware
    }
};

/**
 * @desc    Authenticate admin & get token (Login)
 * @route   POST /api/auth/login
 * @access  Public
 */
export const loginAdmin = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const admin = await Admin.findOne({ where: { email } });

        if (admin && (await admin.matchPassword(password))) {
            const token = generateToken(admin.id);

            // Set token securely in HTTP-Only Cookie
            setTokenCookie(res, token);

            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGIN_SUCCESS, {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                token,
            });
        } else {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, APP_MESSAGES.INVALID_CREDENTIALS);
        }
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Logout Admin by clearing Cookie
 * @route   POST /api/auth/logout
 * @access  Private / Public
 */
export const logoutAdmin = async (req, res, next) => {
    try {
        clearTokenCookie(res);
        return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGOUT_SUCCESS);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get current logged in admin profile
 * @route   GET /api/auth/profile
 * @access  Private
 */
export const getAdminProfile = async (req, res, next) => {
    try {
        const admin = await Admin.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });

        if (admin) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.PROFILE_FETCHED, admin);
        } else {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, APP_MESSAGES.USER_NOT_FOUND);
        }
    } catch (error) {
        next(error);
    }
};
