import Admin from '../../models/superadmin-models/Admin.js';
import { generateToken } from '../../helpers/jwt.helper.js';
import { setTokenCookie, clearTokenCookie } from '../../helpers/cookie.helper.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import { addFcmToken, removeFcmToken } from '../../utils/fcmHelper.js';
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
            role: 'staff',
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, APP_MESSAGES.REGISTER_SUCCESS, {
            id: admin.id,
            name: admin.name,
            email: admin.email,
            role: admin.role,
        });
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
        const { email, password, fcmtoken } = req.body;

        const admin = await Admin.findOne({ where: { email } });

        if (admin && (await admin.matchPassword(password))) {
            const token = generateToken(admin.id);

            // Set token securely in HTTP-Only Cookie
            setTokenCookie(res, token);

            if (fcmtoken) {
                admin.fcmtoken = addFcmToken(admin.fcmtoken, fcmtoken);
                await admin.save();
            }

            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGIN_SUCCESS, {
                id: admin.id,
                name: admin.name,
                email: admin.email,
                role: admin.role,
                phone: admin.phone,
                profileImage: admin.profileImage,
                permissions: admin.permissions || {},
                fcmtoken: admin.fcmtoken,
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
        const tokenToRemove = req.body.fcmtoken || req.query.fcmtoken;
        if (tokenToRemove && req.user?.id) {
            const admin = await Admin.findByPk(req.user.id);
            if (admin) {
                admin.fcmtoken = removeFcmToken(admin.fcmtoken, tokenToRemove);
                await admin.save();
            }
        }
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

/**
 * @desc    Update Admin FCM Token
 * @route   PUT /api/auth/fcm-token
 * @access  Private
 */
export const updateAdminFcmToken = async (req, res, next) => {
    try {
        const { fcmtoken } = req.body;
        if (!fcmtoken) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide fcmtoken");
        }

        const admin = await Admin.findByPk(req.user.id);
        if (!admin) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Admin not found");
        }

        admin.fcmtoken = addFcmToken(admin.fcmtoken, fcmtoken);
        await admin.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "FCM token updated successfully", {
            fcmtoken: admin.fcmtoken
        });
    } catch (error) {
        next(error);
    }
};
