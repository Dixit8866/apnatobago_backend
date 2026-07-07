import { Op } from 'sequelize';
import { User, Order, InventoryStock, GodownStaff, Godown } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';

/**
 * @desc    Get Godown Dashboard Stats
 * @route   GET /api/godown-panel/dashboard
 * @access  Private (GodownStaff)
 */
export const getGodownDashboard = async (req, res, next) => {
    try {
        const staff = req.user;
        const isSuperAdmin = staff.role === 'superadmin';
        const godownId = staff.godownId;

        // Build godown filter — superadmin sees all
        const godownFilter = isSuperAdmin ? {} : { godownId };

        // Total assigned parties
        const totalParties = await User.count({
            where: {
                status: 'Active',
                ...(!isSuperAdmin && { godownId }),
            }
        });

        // Today's orders
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayOrders = await Order.count({
            where: {
                ...godownFilter,
                createdAt: { [Op.between]: [todayStart, todayEnd] },
            }
        });

        // Pending orders
        const pendingOrders = await Order.count({
            where: {
                ...godownFilter,
                orderStatus: { [Op.in]: ['Pending', 'Packaging', 'Packed', 'Shipping'] },
            }
        });

        // Total orders count
        const totalOrders = await Order.count({
            where: {
                ...godownFilter,
                orderStatus: 'Delivered'
            }
        });

        // Sum of sales (delivered orders)
        const totalSalesSum = await Order.sum('totalAmount', {
            where: {
                ...godownFilter,
                orderStatus: 'Delivered'
            }
        });
        const totalSales = Number(totalSalesSum || 0);

        // Low stock count (base units <= 10)
        const inventoryFilter = isSuperAdmin ? {} : { godownId };
        const lowStockCount = await InventoryStock.count({
            where: {
                ...inventoryFilter,
                totalBaseUnits: { [Op.lte]: 10 }
            }
        });

        // Recent 5 orders
        const recentOrders = await Order.findAll({
            where: godownFilter,
            include: [{ model: User, as: 'user', attributes: ['fullname'] }],
            limit: 5,
            order: [['createdAt', 'DESC']]
        });

        // Godown info
        const godownInfo = godownId
            ? await Godown.findByPk(godownId, { attributes: ['id', 'name', 'type', 'address', 'status'] })
            : null;

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Dashboard stats fetched', {
            totalOrders,
            totalSales,
            activeParties: totalParties,
            lowStockCount,
            recentOrders
        });
    } catch (error) {
        next(error);
    }
};
