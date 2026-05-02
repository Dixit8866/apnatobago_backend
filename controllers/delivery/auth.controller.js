import DeliveryBoy from '../../models/superadmin-models/DeliveryBoy.js';
import { generateToken } from '../../helpers/jwt.helper.js';
import { setTokenCookie } from '../../helpers/cookie.helper.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';

/**
 * @desc    Authenticate delivery boy & get token (Login)
 * @route   POST /api/delivery/auth/login
 * @access  Public
 */
export const loginDeliveryBoy = async (req, res, next) => {
    try {
        const { phoneNumber, password } = req.body;

        if (!phoneNumber || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Phone number and password are required.");
        }

        // Find delivery boy by phone
        const deliveryBoy = await DeliveryBoy.findOne({ where: { phone: phoneNumber } });

        if (deliveryBoy && (await deliveryBoy.matchPassword(password))) {
            
            if (deliveryBoy.status !== 'Active') {
                return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Your account is inactive. Please contact admin.");
            }

            const token = generateToken(deliveryBoy.id);

            // Set token securely in HTTP-Only Cookie
            setTokenCookie(res, token);

            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.LOGIN_SUCCESS, {
                id: deliveryBoy.id,
                name: deliveryBoy.name,
                phone: deliveryBoy.phone,
                email: deliveryBoy.email,
                profileImage: deliveryBoy.profileImage,
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
 * @desc    Get current logged in delivery boy profile
 * @route   GET /api/delivery/auth/profile
 * @access  Private (Delivery Boy)
 */
export const getDeliveryProfile = async (req, res, next) => {
    try {
        const deliveryBoy = await DeliveryBoy.findByPk(req.user.id, {
            attributes: { exclude: ['password'] }
        });

        if (deliveryBoy) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.PROFILE_FETCHED, deliveryBoy);
        } else {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, APP_MESSAGES.USER_NOT_FOUND);
        }
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update delivery boy profile
 * @route   PUT /api/delivery/auth/profile
 * @access  Private (Delivery Boy)
 */
export const updateDeliveryProfile = async (req, res, next) => {
    try {
        const deliveryBoy = await DeliveryBoy.findByPk(req.user.id);

        if (!deliveryBoy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, APP_MESSAGES.USER_NOT_FOUND);
        }

        const { name, email, phone, vehicleNumber, address, profileImage, password } = req.body;

        // Update fields
        deliveryBoy.name = name || deliveryBoy.name;
        deliveryBoy.email = email || deliveryBoy.email;
        deliveryBoy.phone = phone || deliveryBoy.phone;
        deliveryBoy.vehicleNumber = vehicleNumber || deliveryBoy.vehicleNumber;
        deliveryBoy.address = address || deliveryBoy.address;
        deliveryBoy.profileImage = profileImage || deliveryBoy.profileImage;

        if (password) {
            deliveryBoy.password = password;
        }

        await deliveryBoy.save();

        const updatedBoy = deliveryBoy.toJSON();
        delete updatedBoy.password;

        return sendSuccessResponse(res, HTTP_STATUS.OK, APP_MESSAGES.PROFILE_UPDATED, updatedBoy);
    } catch (error) {
        next(error);
    }
};
