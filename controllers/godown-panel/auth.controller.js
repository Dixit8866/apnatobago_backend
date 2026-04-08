import GodownStaff from '../../models/superadmin-models/GodownStaff.js';
import Godown from '../../models/superadmin-models/Godown.js';
import { generateToken } from '../../helpers/jwt.helper.js';
import { setTokenCookie, clearTokenCookie } from '../../helpers/cookie.helper.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';

/**
 * @desc    Authenticate godown staff & get token (Login)
 * @route   POST /api/godown-panel/auth/login
 * @access  Public
 */
export const loginGodownStaff = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        const staff = await GodownStaff.findOne({
            where: { email },
            include: [{ model: Godown, as: 'godown', attributes: ['id', 'name', 'type', 'status'] }]
        });

        if (staff && (await staff.matchPassword(password))) {
            if (staff.status !== 'Active') {
                return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Your godown staff account is inactive.');
            }

            const token = generateToken(staff.id);

            // Set token securely in HTTP-Only Cookie
            setTokenCookie(res, token);

            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGIN_SUCCESS, {
                id: staff.id,
                name: staff.name,
                email: staff.email,
                role: staff.role, // staff or superadmin
                phone: staff.phone,
                profileImage: staff.profileImage,
                godown: staff.godown, // Includes godown details
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
 * @desc    Logout Godown Staff by clearing Cookie
 * @route   POST /api/godown-panel/auth/logout
 * @access  Private / Public
 */
export const logoutGodownStaff = async (req, res, next) => {
    try {
        clearTokenCookie(res);
        return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGOUT_SUCCESS);
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get current logged in godown staff profile
 * @route   GET /api/godown-panel/auth/profile
 * @access  Private
 */
export const getGodownStaffProfile = async (req, res, next) => {
    try {
        const staff = await GodownStaff.findByPk(req.user.id, {
            attributes: { exclude: ['password'] },
            include: [{ model: Godown, as: 'godown', attributes: ['id', 'name', 'type', 'pincodes', 'status'] }]
        });

        if (staff) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.PROFILE_FETCHED, staff);
        } else {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, APP_MESSAGES.USER_NOT_FOUND);
        }
    } catch (error) {
        next(error);
    }
};
