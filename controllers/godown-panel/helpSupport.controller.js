import { Op } from 'sequelize';
import { HelpSupport, User } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';

/**
 * @desc    Get help & support requests for godown parties
 * @route   GET /api/godown-panel/help-support
 * @access  Private (GodownStaff)
 */
export const getGodownHelpSupport = async (req, res, next) => {
    try {
        const staff = req.user;
        const { page = 1, limit = 20, search = '', status = '' } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const userWhere = {
            godownId: staff.godownId,
            ...(search && {
                [Op.or]: [
                    { fullname: { [Op.iLike]: `%${search}%` } },
                    { number: { [Op.iLike]: `%${search}%` } },
                ]
            })
        };

        // Parallel status counts
        const [totalCount, pendingCount, resolvedCount, closedCount] = await Promise.all([
            HelpSupport.count({
                include: [{ model: User, as: 'user', where: { godownId: staff.godownId }, required: true }]
            }),
            HelpSupport.count({
                where: { status: 'Pending' },
                include: [{ model: User, as: 'user', where: { godownId: staff.godownId }, required: true }]
            }),
            HelpSupport.count({
                where: { status: 'Resolved' },
                include: [{ model: User, as: 'user', where: { godownId: staff.godownId }, required: true }]
            }),
            HelpSupport.count({
                where: { status: 'Closed' },
                include: [{ model: User, as: 'user', where: { godownId: staff.godownId }, required: true }]
            }),
        ]);
        const statusCounts = { '': totalCount, Pending: pendingCount, Resolved: resolvedCount, Closed: closedCount };

        const { count, rows } = await HelpSupport.findAndCountAll({
            include: [
                {
                    model: User,
                    as: 'user',
                    where: userWhere,
                    attributes: ['id', 'fullname', 'number', 'city'],
                    required: true,
                }
            ],
            where: {
                ...(status && { status }),
            },
            limit: parseInt(limit),
            offset,
            order: [['createdAt', 'DESC']],
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Help requests fetched', {
            data: rows,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalRecords: count,
            statusCounts
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Update help request status
 * @route   PATCH /api/godown-panel/help-support/:id/status
 * @access  Private (GodownStaff)
 */
export const updateGodownHelpSupportStatus = async (req, res, next) => {
    try {
        const staff = req.user;
        const { id } = req.params;
        const { status } = req.body;

        const request = await HelpSupport.findOne({
            where: { id },
            include: [{
                model: User,
                as: 'user',
                where: {
                    godownId: staff.godownId
                },
                required: true
            }]
        });

        if (!request) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Support request not found or not in your godown');
        }

        request.status = status;
        await request.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Status updated successfully', request);
    } catch (error) {
        next(error);
    }
};
