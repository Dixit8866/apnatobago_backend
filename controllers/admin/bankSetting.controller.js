import BankSetting from '../../models/superadmin-models/BankSetting.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';
import sequelize from '../../config/db.js';

// ─── CREATE ─────────────────────────────────────────────────────────────────
export const createBankSetting = async (req, res, next) => {
    try {
        const { bankName, accountName, accountNumber, ifscCode, image, status } = req.body;

        if (!bankName || !bankName.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Bank Name is required. (બેંકનું નામ જરૂરી છે.)");
        }
        if (!accountName || !accountName.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Account Name is required. (ખાતાધારકનું નામ જરૂરી છે.)");
        }

        const normalizedBankName = bankName.trim();
        const normalizedAccountName = accountName.trim();

        // Check for existing bank settings with same name & account name (non-deleted)
        const existing = await BankSetting.findOne({
            where: {
                bankName: sequelize.where(sequelize.fn('LOWER', sequelize.col('bankName')), normalizedBankName.toLowerCase()),
                accountName: sequelize.where(sequelize.fn('LOWER', sequelize.col('accountName')), normalizedAccountName.toLowerCase()),
                status: { [Op.ne]: 'Deleted' }
            }
        });

        if (existing) {
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                "Bank Setting with this Bank Name and Account Name already exists. (આ બેંક અને ખાતાધારકના નામ સાથેની વિગત પહેલેથી જ અસ્તિત્વમાં છે.)"
            );
        }

        const bankSetting = await BankSetting.create({
            bankName: normalizedBankName,
            accountName: normalizedAccountName,
            accountNumber: accountNumber ? accountNumber.trim() : null,
            ifscCode: ifscCode ? ifscCode.trim() : null,
            image: image || null,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Bank Setting created successfully.", bankSetting);
    } catch (error) {
        next(error);
    }
};

// ─── GET ALL (with pagination, search, status filters) ─────────────────────
export const getBankSettings = async (req, res, next) => {
    try {
        const { search = '', status } = req.query;

        // Search clause for bankName or accountName
        let searchWhere = {};
        if (search.trim()) {
            searchWhere = {
                [Op.or]: [
                    { bankName: { [Op.iLike]: `%${search}%` } },
                    { accountName: { [Op.iLike]: `%${search}%` } }
                ]
            };
        }

        const whereClause = { ...searchWhere };
        if (status) {
            whereClause.status = status;
        } else {
            whereClause.status = { [Op.ne]: 'Deleted' }; // Hide deleted by default
        }

        // Calculate counts for tabs
        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            BankSetting.count({ where: { ...searchWhere, status: 'Active' } }),
            BankSetting.count({ where: { ...searchWhere, status: 'Inactive' } }),
            BankSetting.count({ where: { ...searchWhere, status: 'Deleted' } }),
            BankSetting.count({ where: { ...searchWhere, status: { [Op.ne]: 'Deleted' } } }), // Total excluding deleted for default
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const bankSettings = await BankSetting.findAll({
                where: whereClause,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank Settings fetched successfully.", { categories: bankSettings, statusCounts });
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await BankSetting.findAndCountAll({
            where: whereClause,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);

        // Note: For DataPageLayout compatibility, the paginated array is usually inside rows.
        // We've wrapped it in responseData via formatPaginatedResponse, but let's make sure it matches.
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank Settings fetched successfully.", {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

// ─── GET BY ID ───────────────────────────────────────────────────────────────
export const getBankSettingById = async (req, res, next) => {
    try {
        const bankSetting = await BankSetting.findByPk(req.params.id);
        if (!bankSetting) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Bank Setting not found.");
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank Setting fetched successfully.", bankSetting);
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
export const updateBankSetting = async (req, res, next) => {
    try {
        const { bankName, accountName, accountNumber, ifscCode, image, status } = req.body;
        const bankSetting = await BankSetting.findByPk(req.params.id);
        if (!bankSetting) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Bank Setting not found.");
        }

        const currentBankName = bankName !== undefined ? bankName.trim() : bankSetting.bankName;
        const currentAccountName = accountName !== undefined ? accountName.trim() : bankSetting.accountName;

        if (bankName !== undefined || accountName !== undefined) {
            if (!currentBankName) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Bank Name is required.");
            }
            if (!currentAccountName) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Account Name is required.");
            }

            // Check for duplicate names (excluding current record)
            const existing = await BankSetting.findOne({
                where: {
                    id: { [Op.ne]: req.params.id },
                    bankName: sequelize.where(sequelize.fn('LOWER', sequelize.col('bankName')), currentBankName.toLowerCase()),
                    accountName: sequelize.where(sequelize.fn('LOWER', sequelize.col('accountName')), currentAccountName.toLowerCase()),
                    status: { [Op.ne]: 'Deleted' }
                }
            });

            if (existing) {
                return sendErrorResponse(
                    res,
                    HTTP_STATUS.BAD_REQUEST,
                    "Bank Setting with this Bank Name and Account Name already exists. (આ બેંક અને ખાતાધારકના નામ સાથેની વિગત પહેલેથી જ અસ્તિત્વમાં છે.)"
                );
            }

            bankSetting.bankName = currentBankName;
            bankSetting.accountName = currentAccountName;
        }

        if (accountNumber !== undefined) {
            bankSetting.accountNumber = accountNumber ? accountNumber.trim() : null;
        }

        if (ifscCode !== undefined) {
            bankSetting.ifscCode = ifscCode ? ifscCode.trim() : null;
        }

        if (image !== undefined) {
            bankSetting.image = image;
        }

        if (status) {
            bankSetting.status = status;
        }

        await bankSetting.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank Setting updated successfully.", bankSetting);
    } catch (error) {
        next(error);
    }
};

// ─── SOFT DELETE ─────────────────────────────────────────────────────────────
export const deleteBankSetting = async (req, res, next) => {
    try {
        const bankSetting = await BankSetting.findByPk(req.params.id);
        if (!bankSetting) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Bank Setting not found.");
        }

        bankSetting.status = 'Deleted';
        await bankSetting.save();

        // Call sequelize destroy so paranoid soft-delete timestamp is also populated.
        await bankSetting.destroy();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Bank Setting deleted successfully.");
    } catch (error) {
        next(error);
    }
};
