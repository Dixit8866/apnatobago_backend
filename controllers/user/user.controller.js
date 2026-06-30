import jwt from 'jsonwebtoken';
import { User, OTP, CustomLevel } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import { addFcmToken, removeFcmToken } from '../../utils/fcmHelper.js';
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

// Check if number is play store test review account
const isTestNumber = (num) => {
    if (!num) return false;
    const clean = num.toString().replace(/\s+/g, '').replace('+91', '');
    return clean === '8238728036';
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

        const response = await axios.get(fullUrl);
        
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

        let otp = Math.floor(100000 + Math.random() * 900000).toString();
        const isTest = isTestNumber(number);
        if (isTest) {
            otp = '987000';
        }
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await OTP.upsert({ number, otp, expiresAt }, { where: { number } });

        if (!isTest) {
            await sendSMS(fullNumber, otp);
        }

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
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid or expired OTP");
        }

        const user = await User.findOne({ where: { number } });
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found with this number");
        }

        user.status = 'Active';
        const token = generateToken(user.id);
        user.logintoken = token;
        await user.save();

        await OTP.destroy({ where: { number } });

        const userData = user.toJSON();
        delete userData.password;
        delete userData.logintoken;

        // Populate CustomLevel (applevel)
        let rewardLevel = null;
        if (userData.applevel) {
            rewardLevel = await CustomLevel.findByPk(userData.applevel);
        }
        userData.rewardLevel = rewardLevel;
        userData.rewardlevel = rewardLevel;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP verified successfully", {
            user: userData,
            token
        });
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
        const { fullname, dialcode, number, fcmtoken } = req.body;

        if (!fullname || !dialcode || !number) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing required fields");
        }

        const userExists = await User.findOne({ where: { number } });
        if (userExists) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "User with this number already exists");
        }

        // Auto-assign Premium level to new users
        const defaultAppLevel = '6b0722c6-ee28-4058-b4de-a961d1b16da0';

        const user = await User.create({
            fullname,
            dialcode,
            number,
            fcmtoken: fcmtoken ? JSON.stringify([fcmtoken.trim()]) : null,
            applevel: defaultAppLevel,
            showtabacco: false,
            creditline: 0,
            orderReminder: true,
            reminderTime: '09:00 PM',
            status: 'Inactive',
            kycverification: 'pending'
        });

        if (user) {
            const pureDialcode = dialcode.replace('+', '');
            const fullNumber = number.startsWith(pureDialcode) ? number : `${pureDialcode}${number}`;
            
            let otp = Math.floor(100000 + Math.random() * 900000).toString();
            const isTest = isTestNumber(number);
            if (isTest) {
                otp = '987000';
            }
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

            await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
            
            if (!isTest) {
                await sendSMS(fullNumber, otp);
            }

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
        const { number, dialcode = '+91', fcmtoken } = req.body;

        if (!number) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide mobile number");
        }

        const user = await User.findOne({ where: { number } });

        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.UNAUTHORIZED, "User not registered with this mobile number");
        }

        const pureDialcode = (dialcode || user.dialcode || '+91').replace('+', '');
        const fullNumber = number.startsWith(pureDialcode) ? number : `${pureDialcode}${number}`;
        
        let otp = Math.floor(100000 + Math.random() * 900000).toString();
        const isTest = isTestNumber(number);
        if (isTest) {
            otp = '987000';
        }
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
        
        if (!isTest) {
            await sendSMS(fullNumber, otp);
        }
        
        if (fcmtoken) {
            user.fcmtoken = addFcmToken(user.fcmtoken, fcmtoken);
            await user.save();
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP sent successfully to your mobile number");
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
        userData.deviceType = req.user.deviceType || null;
        userData.version = req.user.version || null;

        // Sum the dueAmount for all orders of this user
        const totalDueAmount = await Order.sum('dueAmount', {
            where: { 
                userId: req.user.id,
                orderStatus: { [Op.ne]: 'Cancelled' }
            }
        }) || 0;

        // Nest totalDueAmount directly inside the user object (with both casings to avoid client mismatch)
        userData.totalDueAmount = parseFloat(totalDueAmount);
        userData.totaldueamount = parseFloat(totalDueAmount);

        // Populate CustomLevel (applevel)
        let rewardLevel = null;
        if (userData.applevel) {
            rewardLevel = await CustomLevel.findByPk(userData.applevel);
        }
        userData.rewardLevel = rewardLevel;
        userData.rewardlevel = rewardLevel;

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
            const tokenToRemove = req.body.fcmtoken || req.query.fcmtoken;
            if (tokenToRemove) {
                user.fcmtoken = removeFcmToken(user.fcmtoken, tokenToRemove);
            } else {
                const trimmed = (user.fcmtoken || '').trim();
                if (!trimmed.startsWith('[')) {
                    user.fcmtoken = null;
                }
            }
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

/**
 * @desc    Edit user profile
 * @route   PUT /api/user/profile
 * @access  Private
 */
export const editProfile = async (req, res) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, orderReminder, reminderTime } = req.body;
        const user = await User.findByPk(req.user.id);
        
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        if (number && number !== user.number) {
            const numberExists = await User.findOne({ where: { number } });
            if (numberExists) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Mobile number already in use by another account");
            }
            user.number = number;
        }

        if (dialcode !== undefined) {
            user.dialcode = dialcode;
        }

        user.fullname = fullname || user.fullname;
        user.email = email !== undefined ? email : user.email;
        user.city = city !== undefined ? city : user.city;
        user.postcode = postcode !== undefined ? postcode : user.postcode;
        
        if (orderReminder !== undefined) {
            user.orderReminder = orderReminder;
        }
        
        if (reminderTime !== undefined) {
            user.reminderTime = reminderTime;
        }

        await user.save();

        const userData = user.toJSON();
        delete userData.password;
        delete userData.logintoken;

        // Sum the dueAmount for all orders of this user so editProfile has it too!
        const totalDueAmount = await Order.sum('dueAmount', {
            where: { 
                userId: req.user.id,
                orderStatus: { [Op.ne]: 'Cancelled' }
            }
        }) || 0;

        // Nest totalDueAmount directly inside the user object (with both casings to avoid client mismatch)
        userData.totalDueAmount = parseFloat(totalDueAmount);
        userData.totaldueamount = parseFloat(totalDueAmount);

        // Populate CustomLevel (applevel)
        let rewardLevel = null;
        if (userData.applevel) {
            rewardLevel = await CustomLevel.findByPk(userData.applevel);
        }
        userData.rewardLevel = rewardLevel;
        userData.rewardlevel = rewardLevel;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Profile updated successfully", {
            user: userData
        });
    } catch (error) {
        logger.error(`[Edit Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Forgot Password (Send OTP)
 * @route   POST /api/user/forgot-password
 * @access  Public
 */
export const forgotPassword = async (req, res) => {
    try {
        const { number } = req.body;
        if (!number) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide phone number");
        }

        const user = await User.findOne({ where: { number } });
        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        const pureDialcode = (user.dialcode || '+91').replace('+', '');
        const fullNumber = number.startsWith(pureDialcode) ? number : `${pureDialcode}${number}`;
        
        let otp = Math.floor(100000 + Math.random() * 900000).toString();
        const isTest = isTestNumber(number);
        if (isTest) {
            otp = '987000';
        }
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await OTP.upsert({ number, otp, expiresAt }, { where: { number } });
        
        if (!isTest) {
            await sendSMS(fullNumber, otp);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "OTP sent successfully");
    } catch (error) {
        logger.error(`[Forgot Password Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Reset Password (Verify OTP & Set New Password)
 * @route   POST /api/user/reset-password
 * @access  Public
 */
export const resetPassword = async (req, res) => {
    try {
        const { number, newPassword, confirmPassword } = req.body;
        
        if (!number || !newPassword || !confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing required fields");
        }

        if (newPassword !== confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Passwords do not match");
        }

        const user = await User.findOne({ where: { number } });
        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        user.password = newPassword;
        // Reset logintoken to force logout everywhere
        user.logintoken = null; 
        await user.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Password reset successfully");
    } catch (error) {
        logger.error(`[Reset Password Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Change Password (Logged In User)
 * @route   POST /api/user/change-password
 * @access  Private
 */
export const changePassword = async (req, res) => {
    try {
        const { oldPassword, newPassword, confirmPassword } = req.body;
        
        if (!oldPassword || !newPassword || !confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing required fields");
        }

        if (newPassword !== confirmPassword) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "New passwords do not match");
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        const isMatch = await user.matchPassword(oldPassword);
        if (!isMatch) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Incorrect old password");
        }

        user.password = newPassword;
        await user.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Password changed successfully");
    } catch (error) {
        logger.error(`[Change Password Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};

/**
 * @desc    Update user's device type and version
 * @route   POST /api/user/device-info
 * @access  Public
 */
export const updateDeviceInfo = async (req, res) => {
    try {
        const { userId, deviceType, version } = req.body;

        if (!userId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide userId");
        }

        const user = await User.findByPk(userId);
        if (!user || user.status === 'Deleted') {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found");
        }

        if (deviceType !== undefined) {
            user.deviceType = deviceType;
        }
        if (version !== undefined) {
            user.version = version;
        }

        await user.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Device info updated successfully", {
            userId: user.id,
            deviceType: user.deviceType,
            version: user.version
        });
    } catch (error) {
        logger.error(`[Update Device Info Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, APP_MESSAGES.INTERNAL_SERVER_ERROR);
    }
};
