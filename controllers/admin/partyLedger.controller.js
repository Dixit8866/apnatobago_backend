import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import {
    getPartyLedger,
    syncPartyLedger,
    recordManualPartyEntry
} from '../../services/partyLedger.service.js';

/**
 * @desc    Get party ledger statement (Double-Entry Debit/Credit Passbook)
 * @route   GET /api/admin/party-ledger/:userId
 * @access  Private (Admin)
 */
export const getPartyLedgerHandler = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'User ID is required');
        }

        const data = await getPartyLedger(userId, req.query);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party ledger statement retrieved successfully', data);
    } catch (error) {
        logger.error(`[getPartyLedgerHandler Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Force re-sync and recalculate party ledger from all orders & payments
 * @route   POST /api/admin/party-ledger/:userId/sync
 * @access  Private (Admin)
 */
export const syncPartyLedgerHandler = async (req, res) => {
    try {
        const { userId } = req.params;
        if (!userId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'User ID is required');
        }

        const data = await syncPartyLedger(userId, { forceRebuild: true });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party ledger synced successfully', data);
    } catch (error) {
        logger.error(`[syncPartyLedgerHandler Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Add manual Debit / Credit voucher to party ledger
 * @route   POST /api/admin/party-ledger/:userId/manual-entry
 * @access  Private (Admin)
 */
export const addManualPartyEntryHandler = async (req, res) => {
    try {
        const { userId } = req.params;
        const { entryType, amount, particulars, paymentMethod, note, date } = req.body;

        if (!userId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'User ID is required');
        }
        if (!entryType || !amount || parseFloat(amount) <= 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Entry type and valid amount are required');
        }

        const adminUser = req.admin || req.user;
        const createdById = adminUser?.id || null;
        const createdByName = adminUser?.name || 'Admin';

        const entry = await recordManualPartyEntry({
            userId,
            entryType,
            amount: parseFloat(amount),
            date: date ? new Date(date) : new Date(),
            particulars,
            paymentMethod: paymentMethod || 'CASH',
            note,
            createdById,
            createdByName
        });

        // Re-fetch updated statement
        const updatedData = await getPartyLedger(userId, {});
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Manual ledger entry recorded successfully', { entry, ledger: updatedData });
    } catch (error) {
        logger.error(`[addManualPartyEntryHandler Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
