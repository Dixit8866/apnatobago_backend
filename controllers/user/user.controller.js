import jwt from 'jsonwebtoken';
import User from '../../models/user/User.js';
import OTP from '../../models/user/Otp.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import APP_MESSAGES from '../../constants/messages.js';
import logger from '../../logger/apiLogger.js';
import axios from 'axios';
import { Op } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

// Token Generation
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '365d',
    });
};

/**
 * @desc    Helper function to send SMS OTP with debugging logs
 */
const sendSMS = async (fullNumber, otp) => {
    try {
        // Clean number (remove '+' if present)
        const cleanNumber = fullNumber.replace('+', '');
        
        // DLT Approved Template: {#var#} is your mobile verification code. Regards, {#var#} Call: {#var#} Team MRSTXI
        // We must fill all 3 variables exactly
        const companyName = "MRSTXI";
        const supportContact = "MRSTXI"; // You can replace this with a support number later
        const text = `${otp} is your mobile verification code. Regards, ${companyName} Call: ${supportContact} Team MRSTXI`;
        
        const smsParams = {
            APIKey: process.env.SMS_API_KEY || 'isGOxtla5EKjl6skCtuFqQ',
            senderid: process.env.SMS_SENDER_ID || 'MRSTXI',
            channel: 2,
            DCS: 0,
            flashsms: 0,
            number: cleanNumber,
            text: text,
            route: 1,
            EntityId: process.env.SMS_ENTITY_ID || '1201159827614998700',
            dlttemplateid: process.env.SMS_TEMPLATE_ID || '1207166081646554203'
        };

        const baseURL = process.env.SMS_BASE_URL || 'https://www.smsgatewayhub.com/api/mt/SendSMS';
        const urlParams = new URLSearchParams(smsParams).toString();
        const fullUrl = `${baseURL}?${urlParams}`;

        console.log(`[SMS Debug] Sending OTP to: ${cleanNumber}`);
        console.log(`[SMS Debug] Using DLT Template Text: ${text}`);
        console.log(`[SMS Debug] Full URL: ${fullUrl}`);

        const response = await axios.get(fullUrl);
        console.log(`[SMS Debug] API Response:`, response.data);
        
        return true;
    } catch (smsError) {
        console.error(`[SMS Error] Failed to send SMS:`, smsError.message);
        logger.error(`[SMS Send Error]: ${smsError.message}`);
        return false;
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
        console.log(`[Auth Debug] sendOtp called for number: ${number}`);

        if (!number) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide phone number");
        }

        const user = await User.findOne({ where: { number } });
        let fullNumber = number;
        if (user && user.dialcode) {
             // Avoid double dialcode (if number already starts with dialcode)
             const pureDialcode = user.dialcode.replace('+', '');
             if (number.startsWith(pureDialcode)) {
                 fullNumber = number;
             } else {
                 fullNumber = `${pureDialcode}${number}`;
             }
        }
        console.log(`[Auth Debug] Full number for OTP: ${fullNumber}`);

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
        console.log(`[Auth Debug] OTP generated: ${otp}`);

        await sendSMS(fullNumber, otp);

        return sendSuccessResponse(res, HTTP_STATUS.OK, `OTP sent successfully`);
    } catch (error) {
        console.error(`[Auth Debug] Error in sendOtp:`, error.message);
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
        console.log(`[Auth Debug] verifyOtp called - Number: ${number}, OTP: ${otp}`);

        if (!number || !otp) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide phone number and OTP");
        }

        const otpRecord = await OTP.findOne({ 
            where: { 
                number, 
                otp,
                expiresAt: { [Op.gt]: new Date() }
            } 
        });

        if (!otpRecord) {
            console.log(`[Auth Debug] OTP Verification Failed`);
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid or expired OTP");
        }

        const user = await User.findOne({ where: { number } });
        if (user) {
            user.status = 'Active';
            await user.save();
            console.log(`[Auth Debug] User ${number} status updated to Active`);
        }

        await OTP.destroy({ where: { number } });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP verified successfully");
    } catch (error) {
        console.error(`[Auth Debug] Error in verifyOtp:`, error.message);
        logger.error(`[Verify OTP Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Register a new user
 * @route   POST /api/user/register
 * @access  Public
 */
export const registerUser = async (req, res) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, confirmPassword, fcmtoken } = req.body;
        console.log(`[Auth Debug] registerUser called - Number: ${number}`);

        if (!fullname || !dialcode || !number || !password || !confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing required fields");
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
            status: 'Inactive',
            kycverification: 'pending'
        });

        if (user) {
            console.log(`[Auth Debug] User record created. Sending OTP...`);
            
            const pureDialcode = dialcode.replace('+', '');
            const fullNumber = number.startsWith(pureDialcode) ? number : `${pureDialcode}${number}`;
            
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
            await sendSMS(fullNumber, otp);

            const token = generateToken(user.id);
            user.logintoken = token;
            await user.save();

            const userData = user.toJSON();
            delete userData.password;
            delete userData.logintoken;

            return sendSuccessResponse(res, HTTP_STATUS.CREATED, "User registered. Please verify OTP.", {
                user: userData,
                token
            });
        }
    } catch (error) {
        console.error(`[Auth Debug] Error in registerUser:`, error.message);
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
        console.log(`[Auth Debug] loginUser called - Number: ${number}`);

        if (!number || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide number and password");
        }

        const user = await User.findOne({ where: { number } });

        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid number or password");
        }

        const isMatch = await user.matchPassword(password);
        if (!isMatch) {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "Invalid number or password");
        }

        if (user.status === 'Inactive') {
            console.log(`[Auth Debug] User Inactive. Re-sending OTP...`);
            const pureDialcode = (user.dialcode || '+91').replace('+', '');
            const fullNumber = number.startsWith(pureDialcode) ? number : `${pureDialcode}${number}`;
            
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
            await sendSMS(fullNumber, otp);
            
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, "Account not verified. OTP sent again.");
        }

        const token = generateToken(user.id);
        user.logintoken = token;
        
        if (fcmtoken) {
            user.fcmtoken = fcmtoken;
        }

        await user.save();

        const userData = user.toJSON();
        delete userData.password;
        delete userData.logintoken;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Login successful", {
            user: userData,
            token
        });
    } catch (error) {
        console.error(`[Auth Debug] Error in loginUser:`, error.message);
        logger.error(`[User Login Error]: ${error.message}`);
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
        const userData = req.user.toJSON();
        delete userData.logintoken;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Profile fetched successfully", {
            user: userData
        });
    } catch (error) {
        logger.error(`[Get Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Logout user
 */
export const logoutUser = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (user) {
            user.logintoken = null;
            user.fcmtoken = null; 
            await user.save();
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Logged out successfully");
    } catch (error) {
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Delete user account
 */
export const deleteAccount = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id);
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        user.status = 'Deleted';
        user.logintoken = null;
        await user.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Account deleted successfully");
    } catch (error) {
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};
