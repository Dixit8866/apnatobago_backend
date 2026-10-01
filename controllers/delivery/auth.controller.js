import { Op } from 'sequelize';
import DeliveryBoy from '../../models/superadmin-models/DeliveryBoy.js';
import { generateToken } from '../../helpers/jwt.helper.js';
import { setTokenCookie } from '../../helpers/cookie.helper.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';

/**
 * @desc    Authenticate delivery boy & get token (Login)
 *          Strictly checks ONLY phoneNumber and password (NO email required)
 * @route   POST /api/delivery/auth/login or POST /api/delivery/login
 * @access  Public
 */
export const loginDeliveryBoy = async (req, res, next) => {
    try {
        // Support any field name passed by mobile/delivery app: phoneNumber, phone, mobile, contact, number, username
        const rawPhone = req.body.phoneNumber ?? req.body.phone ?? req.body.mobile ?? req.body.number ?? req.body.contact ?? req.body.username;
        const password = req.body.password;

        if (!rawPhone || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Phone number and password are required.");
        }

        const phoneStr = String(rawPhone).trim();
        const digitsOnly = phoneStr.replace(/\D/g, '');

        // Generate phone variations to match regardless of stored format (+91, without prefix, spaces, etc.)
        const phoneVariations = new Set();
        phoneVariations.add(phoneStr);
        phoneVariations.add(phoneStr.replace(/\s+/g, ''));

        if (digitsOnly) {
            phoneVariations.add(digitsOnly);
            if (digitsOnly.length >= 10) {
                const last10 = digitsOnly.slice(-10);
                phoneVariations.add(last10);
                phoneVariations.add(`+91${last10}`);
                phoneVariations.add(`+91 ${last10}`);
                phoneVariations.add(`91${last10}`);
                phoneVariations.add(`0${last10}`);
            }
        }

        const orConditions = [
            { phone: Array.from(phoneVariations) }
        ];

        if (digitsOnly.length >= 10) {
            const last10 = digitsOnly.slice(-10);
            orConditions.push({ phone: { [Op.like]: `%${last10}` } });
        }

        // Find delivery boy strictly by phone number (NO email check)
        const deliveryBoy = await DeliveryBoy.findOne({
            where: {
                [Op.or]: orConditions
            }
        });

        if (!deliveryBoy) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid phone number or password.");
        }

        const isMatch = await deliveryBoy.matchPassword(password);
        if (!isMatch) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid phone number or password.");
        }

        if (deliveryBoy.status !== 'Active') {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Your account is inactive. Please contact admin.");
        }

        const token = generateToken(deliveryBoy.id);

        // Set token securely in HTTP-Only Cookie
        setTokenCookie(res, token);

        const deliveryBoyData = {
            id: deliveryBoy.id,
            name: deliveryBoy.name,
            phone: deliveryBoy.phone,
            email: deliveryBoy.email || '',
            profileImage: deliveryBoy.profileImage || null,
            vehicleNumber: deliveryBoy.vehicleNumber || null,
            address: deliveryBoy.address || null,
            salary: deliveryBoy.salary || null,
            status: deliveryBoy.status,
            token,
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Login successful.", {
            ...deliveryBoyData,
            user: { ...deliveryBoyData }
        });
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
        if (email !== undefined) {
            deliveryBoy.email = (email && email.trim() !== '') ? email.trim() : null;
        }
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
