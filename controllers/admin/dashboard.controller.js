import { Order, PurchaseBill, OrderItem, Product, ProductVariant, MainCategory, User, Vendor, InventoryStock, Volume } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { Op, fn, col, literal } from 'sequelize';
import logger from '../../logger/apiLogger.js';

export const getDashboardStats = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        
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

        // 1. Total Sales
        const totalSales = await Order.sum('totalAmount', { 
            where: { 
                ...dateFilter,
                orderStatus: { [Op.ne]: 'Cancelled' }
            } 
        }) || 0;

        // 2. Total Purchase
        const totalPurchase = await PurchaseBill.sum('totalAmount', { where: dateFilter }) || 0;

        // 3. Payment Bifurcation
        const paymentStats = await Order.findAll({
            where: { ...dateFilter, orderStatus: { [Op.ne]: 'Cancelled' } },
            attributes: [
                'paymentMethod',
                [fn('SUM', col('totalAmount')), 'total']
            ],
            group: ['paymentMethod']
        });

        // 4. Total Outstanding (Money yet to be received)
        const totalOutstanding = await Order.sum('totalAmount', {
            where: {
                paymentStatus: 'Pending',
                orderStatus: { [Op.ne]: 'Cancelled' }
            }
        }) || 0;

        // 5. Total Received (Money already collected)
        const totalReceived = await Order.sum('totalAmount', {
            where: {
                ...dateFilter,
                paymentStatus: 'Paid',
                orderStatus: { [Op.ne]: 'Cancelled' }
            }
        }) || 0;

        // 6. Payables (Outstanding to vendors)
        const totalPayable = totalPurchase; 

        // 6. Top Selling Products
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
                        ...dateFilter,
                        orderStatus: { [Op.ne]: 'Cancelled' }
                    } 
                }
            ],
            group: ['productId', 'product.id'],
            order: [[literal('"totalQty"'), 'DESC']],
            limit: 5,
            subQuery: false
        });

        // 7. Top Selling Categories
        const topCategories = await OrderItem.findAll({
            attributes: [
                [col('product.mainCategoryId'), 'categoryId'],
                [fn('SUM', col('quantity')), 'totalQty']
            ],
            include: [
                { 
                    model: Product, 
                    as: 'product', 
                    attributes: ['id', 'mainCategoryId'],
                    include: [{ model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] }]
                },
                { 
                    model: Order, 
                    as: 'order', 
                    attributes: [], 
                    where: { 
                        ...dateFilter,
                        orderStatus: { [Op.ne]: 'Cancelled' }
                    } 
                }
            ],
            group: [
                'product.mainCategoryId', 
                'product.id', 
                'product.mainCategory.id'
            ],
            order: [[literal('"totalQty"'), 'DESC']],
            limit: 5,
            subQuery: false
        });

        // 8. Product Expiry Soon (Next 30 days)
        const expirySoon = await InventoryStock.findAll({
            where: {
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

        // 9. Sales Trend (Last 7 days or date range)
        const salesTrend = await Order.findAll({
            where: { ...dateFilter, orderStatus: { [Op.ne]: 'Cancelled' } },
            attributes: [
                [fn('DATE', col('Order.createdAt')), 'date'],
                [fn('SUM', col('totalAmount')), 'total']
            ],
            group: [fn('DATE', col('Order.createdAt'))],
            order: [[fn('DATE', col('Order.createdAt')), 'ASC']]
        });

        // 10. Enrich names (handle JSONB)
        const enrichedProducts = topSellingProducts.map(p => {
            const d = p.toJSON();
            const name = d.product?.name?.en || Object.values(d.product?.name || {})[0] || 'Product';
            if (d.product) d.product.name = name; // Update for frontend ease
            d.productName = name;
            return d;
        });

        const enrichedCategories = topCategories.map(c => {
            const d = c.toJSON();
            d.categoryName = d.product?.mainCategory?.title?.en || Object.values(d.product?.mainCategory?.title || {})[0] || 'Category';
            return d;
        });

        const enrichedExpiry = expirySoon.map(item => {
            const d = item.toJSON();
            const name = d.product?.name?.en || Object.values(d.product?.name || {})[0] || 'Product';
            if (d.product) d.product.name = name;
            return d;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Dashboard stats fetched successfully.", {
            summary: {
                totalSales,
                totalPurchase,
                totalOutstanding,
                totalReceived,
                totalPayable,
            },
            paymentBifurcation: paymentStats,
            topProducts: enrichedProducts,
            topCategories: enrichedCategories,
            expirySoon: enrichedExpiry,
            salesTrend: salesTrend
        });
    } catch (error) {
        logger.error(`[Dashboard Stats Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
