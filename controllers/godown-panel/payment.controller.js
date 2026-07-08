import { Op } from 'sequelize';
import { OrderPayment, Order, User, OrderItem, Product, ProductVariant, BusinessProfile } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';

/**
 * @desc    Get payments for godown parties
 * @route   GET /api/godown-panel/payments
 * @access  Private (GodownStaff)
 */
export const getGodownPayments = async (req, res, next) => {
    try {
        const staff = req.user;
        const { page = 1, limit = 20, search = '', status = '' } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const { count, rows } = await OrderPayment.findAndCountAll({
            include: [
                {
                    model: Order,
                    as: 'order',
                    where: {
                        godownId: staff.godownId,
                        ...(search && {
                            [Op.or]: [
                                { orderId: { [Op.iLike]: `%${search}%` } },
                                { customerName: { [Op.iLike]: `%${search}%` } },
                            ]
                        }),
                    },
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['id', 'fullname', 'number'],
                            required: false,
                        }
                    ],
                    required: true,
                }
            ],
            where: {
                ...(status && { paymentStatus: status }),
            },
            limit: parseInt(limit),
            offset,
            order: [['createdAt', 'DESC']],
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Payments fetched', {
            data: rows,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalRecords: count,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Bulk verify payment collection — moves orders to 'Payment Verify' status
 * @route   PUT /api/godown-panel/payments/bulk-verify
 * @access  Private (GodownStaff)
 */
export const bulkVerifyPayments = async (req, res, next) => {
    try {
        const staff = req.user;
        const { orderIds, note } = req.body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'No order IDs provided');
        }

        // Only allow verifying orders that belong to this godown
        const whereClause = {
            id: { [Op.in]: orderIds },
            orderStatus: 'Payment Collect',
            godownId: staff.godownId,
        };

        const [updatedCount] = await Order.update(
            {
                orderStatus: 'Payment Verify',
                paymentCollectStatus: 'Verified',
                ...(note && { paymentNote: note }),
            },
            { where: whereClause }
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${updatedCount} payment(s) verified successfully`, {
            updatedCount
        });
    } catch (error) {
        next(error);
    }
};
