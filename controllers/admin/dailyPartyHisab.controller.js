import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getDailyPartyHisab } from '../../services/dailyPartyHisab.service.js';

/**
 * @desc    Daily Order No. Hisab — party wise Opening / Sales / Cash / Bank / Kupan / Return / Closing for one day
 * @route   GET /api/admin/payments/daily-party-hisab?date=YYYY-MM-DD
 * @access  Private (Admin)
 */
export const getDailyPartyHisabHandler = async (req, res) => {
    try {
        const godownId = /^[0-9a-f-]{36}$/i.test(String(req.query.godownId || '')) ? req.query.godownId : null;
        const data = await getDailyPartyHisab(req.query.date, { godownId });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Daily party hisab fetched successfully.', data);
    } catch (error) {
        logger.error(`[Daily Party Hisab Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'દૈનિક હિસાબ લોડ કરવામાં ભૂલ આવી.', error.message);
    }
};
