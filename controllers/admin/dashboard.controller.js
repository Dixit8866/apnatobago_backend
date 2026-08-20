import { Order, PurchaseBill, OrderItem, Product, ProductVariant, MainCategory, User, Vendor, InventoryStock, Volume, HelpSupport, OutletOrder, OutletOrderItem } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { Op, fn, col, literal } from 'sequelize';
import logger from '../../logger/apiLogger.js';

function getIndiaTimezoneRange(startDateStr, endDateStr) {
    let startYMD = startDateStr;
    let endYMD = endDateStr;

    if (startDateStr && startDateStr.includes('-')) {
        const parts = startDateStr.split('-');
        if (parts[2]?.length === 4) {
            startYMD = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }

    if (endDateStr && endDateStr.includes('-')) {
        const parts = endDateStr.split('-');
        if (parts[2]?.length === 4) {
            endYMD = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }

    if (!startYMD || !/^\d{4}-\d{2}-\d{2}$/.test(startYMD)) {
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        startYMD = todayStr;
    }
    if (!endYMD || !/^\d{4}-\d{2}-\d{2}$/.test(endYMD)) {
        endYMD = startYMD;
    }

    const startISO = new Date(`${startYMD}T00:00:00+05:30`);
    const endISO = new Date(`${endYMD}T23:59:59.999+05:30`);

    return { startISO, endISO, startYMD, endYMD };
}

export const getDashboardStats = async (req, res) => {
    try {
        const { startDate, endDate, godownId } = req.query;
        
        const dateFilter = {};
        const purchaseDateFilter = {};
        const outletDateFilter = {};

        if (startDate && endDate) {
            const { startISO, endISO, startYMD, endYMD } = getIndiaTimezoneRange(startDate, endDate);
            dateFilter[Op.or] = [
                { createdAt: { [Op.between]: [startISO, endISO] } },
                { orderDate: { [Op.between]: [startYMD, endYMD] } }
            ];
            purchaseDateFilter[Op.or] = [
                { createdAt: { [Op.between]: [startISO, endISO] } },
                { receivedDate: { [Op.between]: [startISO, endISO] } }
            ];
            outletDateFilter.createdAt = { [Op.between]: [startISO, endISO] };
        }

        const cancelledStatuses = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];

        // Build conditional godown filter
        const godownFilter = godownId ? { godownId } : {};

        // 1. Total Sales (sums App orders + Custom Direct Sales + Outlet Orders)
        const appSalesSum = await Order.sum('totalAmount', { 
            where: { 
                ...dateFilter,
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            } 
        }) || 0;

        const outletSalesSum = await OutletOrder.sum('totalAmount', {
            where: {
                ...outletDateFilter,
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const totalSales = Math.round((Number(appSalesSum) + Number(outletSalesSum)) * 100) / 100;

        // 2. Total Purchase
        const totalPurchaseSum = await PurchaseBill.sum('totalAmount', { 
            where: {
                ...purchaseDateFilter,
                ...godownFilter
            }
        }) || 0;
        const totalPurchase = Math.round(Number(totalPurchaseSum) * 100) / 100;

        // 3. Payment Bifurcation
        const paymentStats = await Order.findAll({
            where: { 
                ...dateFilter, 
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses } 
            },
            attributes: [
                'paymentMethod',
                [fn('SUM', col('totalAmount')), 'total']
            ],
            group: ['paymentMethod']
        });

        // 4. Total Outstanding (Money yet to be received from App + Outlet orders)
        const appOutstandingSum = await Order.sum('dueAmount', {
            where: {
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const outletGrandTotalSum = await OutletOrder.sum('grandTotal', {
            where: {
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const outletPaidAmountSum = await OutletOrder.sum('paidAmount', {
            where: {
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const outletOutstandingSum = Math.max(0, Number(outletGrandTotalSum) - Number(outletPaidAmountSum));

        const totalOutstanding = Math.round((Number(appOutstandingSum) + Number(outletOutstandingSum)) * 100) / 100;

        // 5. Total Received (Money already collected from App + Outlet orders)
        const appReceivedSum = await Order.sum('paidAmount', {
            where: {
                ...dateFilter,
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const outletReceivedSum = await OutletOrder.sum('paidAmount', {
            where: {
                ...outletDateFilter,
                ...godownFilter,
                orderStatus: { [Op.notIn]: cancelledStatuses }
            }
        }) || 0;

        const totalReceived = Math.round((Number(appReceivedSum) + Number(outletReceivedSum)) * 100) / 100;

        // 6. Payables (Outstanding to vendors)
        const totalPayable = totalPurchase; 

        // 6.0 Total Profit Calculation across App + Outlet Orders
        let totalCost = 0;
        try {
            const validOrders = await Order.findAll({
                where: {
                    ...dateFilter,
                    ...godownFilter,
                    orderStatus: { [Op.notIn]: cancelledStatuses }
                },
                attributes: ['id', 'totalAmount'],
                include: [{
                    model: OrderItem,
                    as: 'items',
                    attributes: ['quantity', 'price', 'variantId'],
                    include: [{
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['purchasePrice']
                    }]
                }]
            });

            validOrders.forEach(ord => {
                if (Array.isArray(ord.items)) {
                    ord.items.forEach(it => {
                        const qty = Number(it.quantity || 0);
                        const costPrice = Number(it.variant?.purchasePrice || 0);
                        totalCost += qty * costPrice;
                    });
                }
            });

            const validOutletOrders = await OutletOrder.findAll({
                where: {
                    ...outletDateFilter,
                    ...godownFilter,
                    orderStatus: { [Op.notIn]: cancelledStatuses }
                },
                attributes: ['id', 'totalAmount'],
                include: [{
                    model: OutletOrderItem,
                    as: 'items',
                    attributes: ['quantity', 'price', 'variantId'],
                    include: [{
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['purchasePrice']
                    }]
                }]
            });

            validOutletOrders.forEach(ord => {
                if (Array.isArray(ord.items)) {
                    ord.items.forEach(it => {
                        const qty = Number(it.quantity || 0);
                        const costPrice = Number(it.variant?.purchasePrice || 0);
                        totalCost += qty * costPrice;
                    });
                }
            });
        } catch (err) {
            logger.error(`[Dashboard Total Profit Calculation Error]: ${err.message}`);
        }

        const totalProfit = Math.max(0, Math.round((totalSales - totalCost) * 100) / 100);

        // 6.1 New Order Count
        const newOrderCount = await Order.count({
            where: { 
                ...dateFilter, 
                ...godownFilter,
                orderStatus: 'Pending' 
            }
        });

        // 6.2 Delivered Order Count
        const deliveredOrderCount = await Order.count({
            where: { 
                ...dateFilter, 
                ...godownFilter,
                orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] } 
            }
        });

        // 6.3 Today Total Order (summing App + Outlet Orders)
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        const todayStartISO = new Date(`${todayStr}T00:00:00+05:30`);
        const todayEndISO = new Date(`${todayStr}T23:59:59.999+05:30`);

        const todayAppOrderCount = await Order.count({
            where: {
                ...godownFilter,
                [Op.or]: [
                    { createdAt: { [Op.between]: [todayStartISO, todayEndISO] } },
                    { orderDate: todayStr }
                ]
            }
        });

        const todayOutletOrderCount = await OutletOrder.count({
            where: {
                ...godownFilter,
                createdAt: { [Op.between]: [todayStartISO, todayEndISO] }
            }
        });

        const todayTotalOrder = todayAppOrderCount + todayOutletOrderCount;

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
                        ...godownFilter,
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
                        ...godownFilter,
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
                ...godownFilter,
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
            where: { 
                ...dateFilter, 
                ...godownFilter,
                orderStatus: { [Op.ne]: 'Cancelled' } 
            },
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

        // 9.1 Low Stock Count & List
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
                            attributes: ['totalBaseUnits', 'status'],
                            where: godownId ? { godownId } : undefined,
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

        const pendingHelpSupportCount = await HelpSupport.count({
            where: { status: 'Pending' }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Dashboard stats fetched successfully.", {
            summary: {
                totalSales,
                totalPurchase,
                totalOutstanding,
                totalReceived,
                totalPayable,
                totalProfit,
                newOrderCount,
                deliveredOrderCount,
                todayTotalOrder,
                lowStockCount,
                pendingHelpSupportCount
            },
            paymentBifurcation: paymentStats,
            topProducts: enrichedProducts,
            topCategories: enrichedCategories,
            expirySoon: enrichedExpiry,
            salesTrend: salesTrend,
            lowStockProducts: lowStockProducts
        });
    } catch (error) {
        logger.error(`[Dashboard Stats Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
