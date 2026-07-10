import AppSettings from '../../models/superadmin-models/AppSettings.js';
import OrderBlockSetting from '../../models/superadmin-models/OrderBlockSetting.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get App Settings (delivery charges, versions, etc.)
 * @route   GET /api/user/settings
 * @access  Private (User)
 */
export const getAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();
        const orderBlock = await OrderBlockSetting.findOne();
        const orderBlockData = orderBlock ? {
            isBlocked: orderBlock.isBlocked,
            fromDate: orderBlock.fromDate,
            toDate: orderBlock.toDate,
            type: orderBlock.type,
            title: orderBlock.title,
            description: orderBlock.description,
            message: orderBlock.message
        } : {
            isBlocked: false,
            fromDate: null,
            toDate: null,
            type: 'Under Maintenance',
            title: '',
            description: '',
            message: ''
        };

        if (!settings) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", {
                deliveryOnRoundCharge: 0,
                expressDeliveryCharge: 0,
                showExpressDelivery: false,
                freeDeliveryThreshold: 0,
                supportPhoneNumber: '',
                androidVersion: '1.0.0',
                iosVersion: '1.0.0',
                forceUpdate: false,
                deliveryAndroidVersion: '1.0.0',
                deliveryIosVersion: '1.0.0',
                deliveryForceUpdate: false,
                deliveryRoundSchedules: [],
                morningDeliveryStart: '08:00',
                morningDeliveryEnd: '13:00',
                eveningDeliveryStart: '15:00',
                eveningDeliveryEnd: '17:00',
                expressDeliveryStart: '08:00',
                expressDeliveryEnd: '18:00',
                expressDeliverySchedules: [],
                orderBlock: orderBlockData,
                serverUtcTime: new Date().toISOString()
            });
        }

        const settingsData = settings.toJSON();
        delete settingsData.razorpaySecretKey;

        if (Array.isArray(settingsData.deliveryRoundSchedules)) {
            settingsData.deliveryRoundSchedules = settingsData.deliveryRoundSchedules.map((round, index) => ({
                id: round.id || `round_${index + 1}`,
                ...round
            }));
        }

        if (Array.isArray(settingsData.expressDeliverySchedules)) {
            settingsData.expressDeliverySchedules = settingsData.expressDeliverySchedules.map((round, index) => ({
                id: round.id || `express_${index + 1}`,
                ...round
            }));
        }

        // Append server-side UTC timestamp so mobile apps can rely on server time
        // instead of the user's device clock (prevents issues when users change phone time).
        settingsData.serverUtcTime = new Date().toISOString();
        settingsData.orderBlock = orderBlockData;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "App settings fetched successfully", settingsData);
    } catch (error) {
        logger.error(`[Get App Settings Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch app settings");
    }
};

/**
 * @desc    Get Emergency Order Block / Control setting
 * @route   GET /api/user/order-block
 * @access  Public
 */
export const getOrderBlockSetting = async (req, res) => {
    try {
        let setting = await OrderBlockSetting.findOne();
        
        if (!setting) {
            setting = await OrderBlockSetting.create({
                isBlocked: false,
                type: 'Under Maintenance',
                fromDate: null,
                toDate: null,
                title: '',
                description: '',
                message: ''
            });
        }

        // Calculate dynamic active blocking state based on dates & toggle
        let isCurrentlyBlocked = false;
        if (setting.isBlocked) {
            const now = new Date();
            if (setting.fromDate && setting.toDate) {
                const from = new Date(setting.fromDate);
                const to = new Date(setting.toDate);
                if (now >= from && now <= to) {
                    isCurrentlyBlocked = true;
                }
            } else {
                isCurrentlyBlocked = true;
            }
        }

        const defaultMsg = `Order creation is temporarily paused due to ${
            setting.type === 'Monsoon' ? 'monsoon conditions' : 'maintenance'
        }.`;
        const finalMsg = setting.description || setting.message || setting.title || defaultMsg;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Emergency order control settings fetched successfully", {
            isBlocked: setting.isBlocked,
            type: setting.type,
            fromDate: setting.fromDate,
            toDate: setting.toDate,
            title: setting.title,
            description: setting.description,
            message: setting.message,
            isCurrentlyBlocked,
            activeMessage: finalMsg,
            serverUtcTime: new Date().toISOString()
        });
    } catch (error) {
        logger.error(`Error in getOrderBlockSetting (User): ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to fetch order block settings");
    }
};

