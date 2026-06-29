import { AppSettings } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get global app settings
 * @route   GET /api/admin/settings
 * @access  Private (Admin)
 */
const parseTimeTo12Hour = (timeStr) => {
    if (!timeStr) return { time: '', period: 'AM' };
    
    const trimmed = timeStr.trim();
    const hasAMPM = /\s+(AM|PM)$/i.test(trimmed);
    let period = 'AM';
    let time = trimmed;
    
    if (hasAMPM) {
        const parts = trimmed.split(/\s+/);
        time = parts[0] || '';
        period = (parts[1] || 'AM').toUpperCase();
    } else {
        const match24 = trimmed.match(/^(\d{1,2}):(\d{2})/);
        if (match24) {
            let hr24 = parseInt(match24[1], 10);
            let min = match24[2];
            period = hr24 >= 12 ? 'PM' : 'AM';
            let hr12 = hr24 % 12;
            if (hr12 === 0) hr12 = 12;
            time = `${hr12.toString().padStart(2, '0')}:${min}`;
        }
    }
    
    return { time, period };
};

const formatTimeToDatabase = (time, period) => {
    return `${time || ''} ${period || 'AM'}`.trim();
};

const normalizeTimeStr = (timeStr, defaultVal) => {
    const parsed = parseTimeTo12Hour(timeStr || defaultVal);
    return formatTimeToDatabase(parsed.time, parsed.period);
};

const normalizeSchedules = (schedules, defaultStart, defaultEnd, defaultVisibleFrom, defaultVisibleTo) => {
    if (!Array.isArray(schedules)) return [];
    return schedules.map((round) => ({
        ...round,
        start: normalizeTimeStr(round.start, defaultStart),
        end: normalizeTimeStr(round.end, defaultEnd),
        visibleFrom: normalizeTimeStr(round.visibleFrom, defaultVisibleFrom),
        visibleTo: normalizeTimeStr(round.visibleTo, defaultVisibleTo)
    }));
};

/**
 * @desc    Get global app settings
 * @route   GET /api/admin/settings
 * @access  Private (Admin)
 */
export const getAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();
        
        if (!settings) {
            // Create default settings if not exists
            settings = await AppSettings.create({});
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Settings fetched successfully", settings);
    } catch (error) {
        logger.error(`Error in getAppSettings: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update global app settings
 * @route   PUT /api/admin/settings
 * @access  Private (Admin)
 */
export const updateAppSettings = async (req, res) => {
    try {
        let settings = await AppSettings.findOne();
        
        const body = { ...req.body };
        
        // Normalize schedules on backend before saving
        if (body.deliveryRoundSchedules) {
            body.deliveryRoundSchedules = normalizeSchedules(body.deliveryRoundSchedules, '08:00 AM', '01:00 PM', '12:00 AM', '12:00 PM');
        }
        if (body.expressDeliverySchedules) {
            body.expressDeliverySchedules = normalizeSchedules(body.expressDeliverySchedules, '09:00 AM', '06:00 PM', '12:00 AM', '06:00 PM');
        }
        
        // Normalize top-level times
        if (body.morningDeliveryStart) body.morningDeliveryStart = normalizeTimeStr(body.morningDeliveryStart, '08:00 AM');
        if (body.morningDeliveryEnd) body.morningDeliveryEnd = normalizeTimeStr(body.morningDeliveryEnd, '01:00 PM');
        if (body.eveningDeliveryStart) body.eveningDeliveryStart = normalizeTimeStr(body.eveningDeliveryStart, '03:00 PM');
        if (body.eveningDeliveryEnd) body.eveningDeliveryEnd = normalizeTimeStr(body.eveningDeliveryEnd, '05:00 PM');
        if (body.expressDeliveryStart) body.expressDeliveryStart = normalizeTimeStr(body.expressDeliveryStart, '09:00 AM');
        if (body.expressDeliveryEnd) body.expressDeliveryEnd = normalizeTimeStr(body.expressDeliveryEnd, '06:00 PM');

        if (!settings) {
            settings = await AppSettings.create(body);
        } else {
            await settings.update(body);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Settings updated successfully", settings);
    } catch (error) {
        logger.error(`Error in updateAppSettings: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
