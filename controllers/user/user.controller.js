import jwt from 'jsonwebtoken';
import User from '../../models/user/User.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';
import logger from '../../logger/apiLogger.js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

// Token Generation
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '365d',
    });
};

/**
 * @desc    Register a new user
 * @route   POST /api/user/register
 * @access  Public
 */
export const registerUser = async (req, res) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, confirmPassword, fcmtoken } = req.body;

        if (!fullname || !dialcode || !number || !password || !confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, APP_MESSAGES.VALIDATION_ERROR || "Missing required fields");
        }

        if (password !== confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Passwords do not match");
        }

        const userExists = await User.findOne({ where: { number } });
        if (userExists) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "User with this number already exists");
        }

        const user = await User.create({
            fullname,
            email,
            dialcode,
            number,
            city,
            postcode,
            password,
            fcmtoken,
            showtabacco: false,
            creditline: 0,
            status: 'Active'
        });

        if (user) {
            const token = generateToken(user.id);
            user.logintoken = token;
            await user.save();

            const userData = user.toJSON();
            delete userData.password;

            return sendSuccessResponse(res, HTTP_STATUS.CREATED, "User registered successfully", {
                user: userData,
                token
            });
        }
    } catch (error) {
        logger.error(`[User Register Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Login user
 * @route   POST /api/user/login
 * @access  Public
 */
export const loginUser = async (req, res) => {
    try {
        const { number, password, fcmtoken } = req.body;

        if (!number || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide number and password");
        }

        const user = await User.findOne({ where: { number } });

        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid number or password, or account is deleted");
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid number or password");
        }

        if (user.status === 'Inactive') {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Your account is inactive. Contact support.");
        }

        const token = generateToken(user.id);
        user.logintoken = token;
        
        if (fcmtoken) {
            user.fcmtoken = fcmtoken;
        }

        await user.save();

        const userData = user.toJSON();
        delete userData.password;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Login successful", {
            user: userData,
            token
        });
    } catch (error) {
        logger.error(`[User Login Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Send OTP to phone number
 * @route   POST /api/user/send-otp
 * @access  Public
 */
export const sendOtp = async (req, res) => {
    try {
        const { number } = req.body;
        if (!number) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide phone number");
        }

        const user = await User.findOne({ where: { number } });
        if (!user) {
             return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found with this number");
        }

        // Generate 6 digit OTP random
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        user.otp = otp;
        user.otpExpires = otpExpires;
        await user.save();

        // Send OTP Using Config
        const text = `Dear Customer, your OTP for verification is ${otp}. Do not share it with anyone.`;
        
        try {
            const smsParams = {
                APIKey: process.env.SMS_API_KEY || 'isGOxtla5EKjl6skCtuFqQ',
                senderid: process.env.SMS_SENDER_ID || 'MRSTXI',
                channel: 2,
                DCS: 0,
                flashsms: 0,
                number: number,
                text: text,
                route: 1,
                EntityId: process.env.SMS_ENTITY_ID || '1201159827614998700',
                dlttemplateid: process.env.SMS_TEMPLATE_ID || '1207166081646554203'
            };

            const baseURL = process.env.SMS_BASE_URL || 'https://www.smsgatewayhub.com/api/mt/SendSMS';

            // Send via GET
             const urlParams = new URLSearchParams(smsParams).toString();
             const fullUrl = `${baseURL}?${urlParams}`;
             
             await axios.get(fullUrl);
        } catch (smsError) {
             logger.error(`[SMS Send Error]: ${smsError.message}`);
             // Will not block response if SMS provider fails, but good to log it.
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP sent successfully to your number");
    } catch (error) {
        logger.error(`[Send OTP Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Verify OTP
 * @route   POST /api/user/verify-otp
 * @access  Public
 */
export const verifyOtp = async (req, res) => {
    try {
        const { number, otp } = req.body;
        if (!number || !otp) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide phone number and OTP");
        }

        const user = await User.findOne({ where: { number } });
        if (!user) {
             return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        if (user.otp !== otp) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid OTP provided");
        }

        if (user.otpExpires && new Date() > user.otpExpires) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "OTP has expired");
        }

        // OTP Verified
        user.otp = null;
        user.otpExpires = null;
        await user.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP verified successfully");
    } catch (error) {
        logger.error(`[Verify OTP Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Get user profile using token
 * @route   GET /api/user/profile
 * @access  Private (Requires Token)
 */
export const getProfile = async (req, res) => {
    try {
        // req.user is set by auth middleware
        const user = req.user;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Profile fetched successfully", {
            user
        });
    } catch (error) {
        logger.error(`[Get Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Logout user (removes login token)
 * @route   POST /api/user/logout
 * @access  Private (Requires Token)
 */
export const logoutUser = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (user) {
            user.logintoken = null; // Remove token
            user.fcmtoken = null; // Removing fcm token to stop further notifications
            await user.save();
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Logged out successfully");
    } catch (error) {
        logger.error(`[Logout Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Delete user account (Soft Delete)
 * @route   DELETE /api/user/delete-account
 * @access  Private (Requires Token)
 */
export const deleteAccount = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        user.status = 'Deleted';
        user.logintoken = null;
        user.fcmtoken = null;
        await user.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Account deleted successfully");
    } catch (error) {
        logger.error(`[Delete Account Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};
