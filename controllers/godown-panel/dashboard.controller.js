import { Op, fn, col, literal } from 'sequelize';
import {
    User,
    Order,
    OrderItem,
    Product,
    ProductVariant,
    Volume,
    InventoryStock,
    GodownStaff,
    Godown,
    HelpSupport,
    PurchaseBill
} from '../../models/index.js';
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
        const godownId = staff.godownId;

        const { startDate, endDate } = req.query;

        // Build godown filters
        const godownFilter = { godownId };
        const inventoryFilter = { godownId };

        const dateFilter = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);

            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            dateFilter.createdAt = {
                [Op.between]: [start, end]
            };
        }

        const cancelledStatuses = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];

        // 1. Total Sales (sum of totalAmount for active orders)
        const totalSalesSum = await Order.sum('totalAmount', {
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        });
        const totalSales = Number(totalSalesSum || 0);

        // 2. Total Purchase (sum of totalAmount for purchase bills in this godown)
        const totalPurchaseSum = await PurchaseBill.sum('totalAmount', {
            where: {
                ...godownFilter,
                ...dateFilter
            }
        });
        const totalPurchase = Number(totalPurchaseSum || 0);
        const totalPayable = totalPurchase;

        // 3. New Order Count (Pending)
        const newOrderCount = await Order.count({
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: 'Pending'
            }
        });

        // 4. Today Total Orders (placed today in this godown)
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        const todayTotalOrder = await Order.count({
            where: {
                ...godownFilter,
                createdAt: { [Op.between]: [todayStart, todayEnd] }
            }
        });

        // 5. Delivered Order Count (Delivered, Payment Collect, Payment Verify)
        const deliveredOrderCount = await Order.count({
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] }
            }
        });

        // 6. Total Received (paidAmount for active orders)
        const totalReceivedSum = await Order.sum('paidAmount', {
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        });
        const totalReceived = Number(totalReceivedSum || 0);

        // 7. Total Outstanding (dueAmount for active orders)
        const totalOutstandingSum = await Order.sum('dueAmount', {
            where: {
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        });
        const totalOutstanding = Number(totalOutstandingSum || 0);

        // 8. Active Parties (total parties assigned to this godown)
        const totalParties = await User.count({
            where: {
                status: 'Active',
                godownId,
            }
        });

        // 9. Pending Help & Support Count from this godown's parties
        const pendingHelpSupportCount = await HelpSupport.count({
            where: { status: 'Pending' },
            include: [{ model: User, as: 'user', where: { godownId }, required: true }]
        });

        // 10. Payment Bifurcation for this godown
        const paymentStats = await Order.findAll({
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            },
            attributes: [
                'paymentMethod',
                [fn('SUM', col('totalAmount')), 'total']
            ],
            group: ['paymentMethod']
        });

        const paymentData = paymentStats.map(p => ({
            paymentMethod: p.paymentMethod || 'Unknown',
            total: p.getDataValue('total') || 0
        }));

        // 11. Sales Trend (group by day) within date range
        const salesTrendStats = await Order.findAll({
            where: {
                ...godownFilter,
                ...dateFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            },
            attributes: [
                [fn('DATE', col('Order.createdAt')), 'date'],
                [fn('SUM', col('totalAmount')), 'total']
            ],
            group: [fn('DATE', col('Order.createdAt'))],
            order: [[fn('DATE', col('Order.createdAt')), 'ASC']]
        });

        const salesTrend = salesTrendStats.map(s => ({
            date: s.getDataValue('date'),
            total: Number(s.getDataValue('total') || 0)
        }));

        // 12. Top Selling Products in this godown
        const topSellingProducts = await OrderItem.findAll({
            attributes: [
                'productId',
                [fn('SUM', col('quantity')), 'totalQty'],
                [fn('SUM', literal('quantity * price')), 'totalRevenue']
            ],
            include: [
                { model: Product, as: 'product', attributes: ['id', 'name'] },
                {
                    model: Order,
                    as: 'order',
                    attributes: [],
                    where: {
                        ...godownFilter,
                        ...dateFilter,
                        orderStatus: { [Op.notIn]: cancelledStatuses }
                    }
                }
            ],
            group: ['productId', 'product.id'],
            order: [[literal('"totalQty"'), 'DESC']],
            limit: 5,
            subQuery: false
        });

        const enrichedProducts = topSellingProducts.map(p => {
            const d = p.toJSON();
            const name = d.product?.name?.en || Object.values(d.product?.name || {})[0] || 'Product';
            if (d.product) d.product.name = name;
            d.productName = name;
            d.totalQty = Number(d.totalQty || 0);
            d.totalRevenue = Number(d.totalRevenue || 0);
            return d;
        });

        // 13. Expiry Soon in this godown
        const expirySoon = await InventoryStock.findAll({
            where: {
                ...inventoryFilter,
                status: 'Active',
                expiryDate: {
                    [Op.and]: [
                        { [Op.gt]: new Date() },
                        { [Op.lt]: new Date(new Date().setDate(new Date().getDate() + 30)) }
                    ]
                }
            },
            include: [
                { model: Product, as: 'product', attributes: ['name'] },
                { model: ProductVariant, as: 'variant', attributes: ['volume'] }
            ],
            limit: 5,
            order: [['expiryDate', 'ASC']]
        });

        const enrichedExpiry = expirySoon.map(item => {
            const d = item.toJSON();
            const name = d.product?.name?.en || Object.values(d.product?.name || {})[0] || 'Product';
            if (d.product) d.product.name = name;
            return d;
        });

        // 14. Low Stock count & products in this godown
        const activeProducts = await Product.findAll({
            where: { status: 'Active' },
            attributes: ['id', 'name', 'thumbnail'],
            include: [
                {
                    model: ProductVariant,
                    as: 'variants',
                    where: { status: 'Active' },
                    required: true,
                    include: [
                        {
                            model: Volume,
                            as: 'volumeRef',
                            attributes: ['id', 'name']
                        },
                        {
                            model: InventoryStock,
                            as: 'inventoryStocks',
                            where: { godownId, status: 'Active' },
                            attributes: ['totalBaseUnits', 'status'],
                            required: false
                        }
                    ]
                }
            ]
        });

        let lowStockCount = 0;
        const lowStockProducts = [];

        for (const product of activeProducts) {
            const variants = product.variants || [];
            if (variants.length === 0) continue;

            let allVariantsLow = true;
            const variantStocks = [];

            for (const variant of variants) {
                const activeStocks = (variant.inventoryStocks || []).filter(s => s.status === 'Active');
                const totalStock = activeStocks.reduce((sum, s) => sum + parseFloat(s.totalBaseUnits || 0), 0);

                if (totalStock > 10) {
                    allVariantsLow = false;
                }

                const unitNameObj = variant.volumeRef?.name || {};
                const unitName = unitNameObj.en || Object.values(unitNameObj)[0] || '';
                const fullVolume = `${variant.volume || ''} ${unitName}`.trim();

                variantStocks.push({
                    variantId: variant.id,
                    volume: fullVolume || variant.volume,
                    totalStock: totalStock
                });
            }

            if (allVariantsLow) {
                lowStockCount++;
                const pName = product.name?.en || Object.values(product.name || {})[0] || 'Product';
                lowStockProducts.push({
                    productId: product.id,
                    productName: pName,
                    image: product.thumbnail,
                    variants: variantStocks
                });
            }
        }

        // 15. Recent 5 orders
        const recentOrders = await Order.findAll({
            where: godownFilter,
            include: [{ model: User, as: 'user', attributes: ['fullname'] }],
            limit: 5,
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Godown Dashboard stats fetched successfully.", {
            summary: {
                totalSales,
                totalPurchase,
                totalPayable,
                newOrderCount,
                todayTotalOrder,
                deliveredOrderCount,
                totalReceived,
                totalOutstanding,
                activeParties: totalParties,
                pendingHelpSupportCount,
                lowStockCount
            },
            paymentBifurcation: paymentData,
            topProducts: enrichedProducts,
            expirySoon: enrichedExpiry,
            salesTrend,
            lowStockProducts,
            recentOrders
        });
    } catch (error) {
        next(error);
    }
};
