import { Op } from 'sequelize';
import { BillPrintSetting, Volume } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Setting row with the selected volumes' names (the thermal bill matches units by name)
const withVolumes = async (setting) => {
    const ids = Array.isArray(setting.summaryVolumeIds) ? setting.summaryVolumeIds : [];
    const volumes = ids.length > 0
        ? await Volume.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'name'] })
        : [];
    return { id: setting.id, summaryVolumeIds: ids, summaryVolumes: volumes };
};

/**
 * @desc    Get bill print settings
 * @route   GET /api/admin/bill-print-settings
 * @access  Private (Admin)
 */
export const getBillPrintSetting = async (req, res) => {
    try {
        let setting = await BillPrintSetting.findOne();
        if (!setting) {
            setting = await BillPrintSetting.create({ summaryVolumeIds: [] });
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bill print settings fetched successfully", await withVolumes(setting));
    } catch (error) {
        logger.error(`Error in getBillPrintSetting: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update bill print settings
 * @route   PUT /api/admin/bill-print-settings
 * @access  Private (Admin)
 */
export const updateBillPrintSetting = async (req, res) => {
    try {
        const { summaryVolumeIds } = req.body;
        if (!Array.isArray(summaryVolumeIds) || summaryVolumeIds.some(id => !UUID_PATTERN.test(String(id)))) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "summaryVolumeIds must be a list of volume IDs.");
        }
        const ids = [...new Set(summaryVolumeIds.map(String))];
        const found = ids.length > 0 ? await Volume.count({ where: { id: { [Op.in]: ids } } }) : 0;
        if (found !== ids.length) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Some selected volumes were not found.");
        }

        let setting = await BillPrintSetting.findOne();
        if (!setting) {
            setting = await BillPrintSetting.create({ summaryVolumeIds: ids });
        } else {
            await setting.update({ summaryVolumeIds: ids });
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bill print settings updated successfully", await withVolumes(setting));
    } catch (error) {
        logger.error(`Error in updateBillPrintSetting: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
