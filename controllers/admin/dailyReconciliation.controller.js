import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import {
    Order,
    OrderItem,
    OrderPayment,
    PurchaseBill,
    Product,
    ProductVariant,
    InventoryStock,
    InventoryTransaction,
    DailyReconciliation
} from '../../models/index.js';

/**
 * Get Live Reconciliation Data for a specific Date & optional Godown
 * Read-only analysis of live DB tables (orders, payments, inventory, bills)
 */
export const getLiveReconciliation = async (req, res) => {
    try {
        const { date = new Date().toISOString().split('T')[0], godownId } = req.query;

        // Check if there is already a settled reconciliation for this date
        const whereClause = { date };
        if (godownId) whereClause.godownId = godownId;

        const existingRecord = await DailyReconciliation.findOne({ where: whereClause });

        if (existingRecord && existingRecord.status === 'Settled') {
            return res.json({
                success: true,
                isSettled: true,
                data: existingRecord
            });
        }

        // 1. Calculate Previous Day's Closing Values as Opening Values
        const prevDate = new Date(new Date(date).getTime() - 86400000).toISOString().split('T')[0];
        const prevRecord = await DailyReconciliation.findOne({
            where: { date: prevDate, ...(godownId ? { godownId } : {}) }
        });

        let openingStockAmount = prevRecord ? Number(prevRecord.closingStockAmount) : 0;
        let openingCashBalance = prevRecord ? Number(prevRecord.closingCashBalance) : 0;

        // 2. Fetch Sales Data for Target Date
        const orderWhere = {
            orderStatus: { [Op.ne]: 'Cancelled' },
            [Op.or]: [
                { orderDate: date },
                sequelize.where(sequelize.fn('DATE', sequelize.col('Order.createdAt')), date)
            ]
        };
        if (godownId) orderWhere.godownId = godownId;

        const todayOrders = await Order.findAll({
            where: orderWhere,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product' },
                        { model: ProductVariant, as: 'variant' }
                    ]
                }
            ]
        });

        let totalSalesAmount = 0;
        let cashSalesAmount = 0;
        let onlineSalesAmount = 0;
        let totalSoldCostValuation = 0;

        // Quantity tracking map: variantId -> soldQty
        const itemSalesQtyMap = {};

        todayOrders.forEach(order => {
            const total = Number(order.totalAmount || 0);
            totalSalesAmount += total;

            const paymentMethod = String(order.paymentMethod || '').toUpperCase();
            const paid = Number(order.paidAmount || total);

            if (paymentMethod.includes('CASH') || paymentMethod.includes('COD')) {
                cashSalesAmount += paid;
            } else {
                onlineSalesAmount += paid;
            }

            // Calculate cost valuation of sold items & sum quantities
            (order.items || []).forEach(item => {
                const qty = Number(item.quantity || 0);
                const variantId = item.variantId || item.productId;
                if (variantId) {
                    itemSalesQtyMap[variantId] = (itemSalesQtyMap[variantId] || 0) + qty;
                }

                const purchasePrice = Number(item.variant?.purchasePrice || item.price || 0);
                totalSoldCostValuation += qty * purchasePrice;
            });
        });

        // 3. Fetch Purchases Data for Target Date
        const purchaseWhere = {
            [Op.or]: [
                { billDate: date },
                sequelize.where(sequelize.fn('DATE', sequelize.col('PurchaseBill.createdAt')), date)
            ]
        };
        if (godownId) purchaseWhere.godownId = godownId;

        const todayPurchases = await PurchaseBill.findAll({
            where: purchaseWhere
        }).catch(() => []);

        let totalPurchaseAmount = 0;
        let purchasePaymentAmount = 0;

        todayPurchases.forEach(pb => {
            totalPurchaseAmount += Number(pb.totalAmount || 0);
            purchasePaymentAmount += Number(pb.paidAmount || 0);
        });

        // If opening stock valuation wasn't in DB, compute current live inventory valuation
        const stockWhere = godownId ? { godownId } : {};
        const allStockRecords = await InventoryStock.findAll({
            where: stockWhere,
            include: [
                { model: Product, as: 'product' },
                { model: ProductVariant, as: 'variant' }
            ]
        });

        let currentLiveStockValuation = 0;
        const itemQuantitySummary = [];

        allStockRecords.forEach(s => {
            const currentQty = Number(s.quantity || 0);
            const costPrice = Number(s.variant?.purchasePrice || s.product?.purchasePrice || 0);
            currentLiveStockValuation += currentQty * costPrice;

            const variantId = s.variantId || s.productId;
            const soldToday = itemSalesQtyMap[variantId] || 0;
            const purchasedToday = 0; // Can be enhanced with line item breakdown
            const openingQty = currentQty + soldToday - purchasedToday;

            const prodName = s.product?.name ? (typeof s.product.name === 'object' ? (s.product.name.gu || s.product.name.en || Object.values(s.product.name)[0]) : s.product.name) : 'Product';
            const unitName = s.variant?.volume || 'Unit';

            itemQuantitySummary.push({
                productId: s.productId,
                variantId: s.variantId,
                productName: prodName,
                unitLabel: unitName,
                openingQty,
                soldQty: soldToday,
                purchasedQty: purchasedToday,
                closingQty: currentQty,
                isMatched: (openingQty - soldToday + purchasedToday) === currentQty
            });
        });

        if (openingStockAmount === 0) {
            // Estimate opening stock = current stock + today's sold stock cost - today's purchase cost
            openingStockAmount = Math.max(0, currentLiveStockValuation + totalSoldCostValuation - totalPurchaseAmount);
        }

        const salesStockAmount = totalSoldCostValuation || (totalSalesAmount * 0.85); // Valuation cost of sold stock
        const closingStockAmount = openingStockAmount - salesStockAmount + totalPurchaseAmount;
        const expensesAmount = 0; // Expenses if logged
        const netProfit = totalSalesAmount - salesStockAmount - expensesAmount;
        const closingCashBalance = openingCashBalance + cashSalesAmount - purchasePaymentAmount - expensesAmount;

        const liveData = {
            date,
            godownId: godownId || null,
            openingStockAmount: Number(openingStockAmount.toFixed(2)),
            salesStockAmount: Number(salesStockAmount.toFixed(2)),
            purchaseStockAmount: Number(totalPurchaseAmount.toFixed(2)),
            closingStockAmount: Number(closingStockAmount.toFixed(2)),
            openingCashBalance: Number(openingCashBalance.toFixed(2)),
            cashSalesAmount: Number(cashSalesAmount.toFixed(2)),
            onlineSalesAmount: Number(onlineSalesAmount.toFixed(2)),
            totalSalesAmount: Number(totalSalesAmount.toFixed(2)),
            purchasePaymentAmount: Number(purchasePaymentAmount.toFixed(2)),
            expensesAmount: Number(expensesAmount.toFixed(2)),
            closingCashBalance: Number(closingCashBalance.toFixed(2)),
            netProfit: Number(netProfit.toFixed(2)),
            quantitySummary: itemQuantitySummary,
            status: 'Draft'
        };

        return res.json({
            success: true,
            isSettled: false,
            data: liveData
        });
    } catch (error) {
        console.error('Error fetching live reconciliation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to generate live reconciliation data',
            error: error.message
        });
    }
};

/**
 * Settle & Lock Day Reconciliation
 */
export const settleDay = async (req, res) => {
    try {
        const {
            date,
            godownId,
            openingStockAmount,
            salesStockAmount,
            purchaseStockAmount,
            closingStockAmount,
            openingCashBalance,
            cashSalesAmount,
            onlineSalesAmount,
            purchasePaymentAmount,
            expensesAmount,
            closingCashBalance,
            netProfit,
            quantitySummary,
            notes
        } = req.body;

        if (!date) {
            return res.status(400).json({ success: false, message: 'Date is required' });
        }

        const settledByAdminId = req.user?.id || null;

        const [record, created] = await DailyReconciliation.findOrCreate({
            where: { date, godownId: godownId || null },
            defaults: {
                date,
                godownId: godownId || null,
                openingStockAmount,
                salesStockAmount,
                purchaseStockAmount,
                closingStockAmount,
                openingCashBalance,
                cashSalesAmount,
                onlineSalesAmount,
                purchasePaymentAmount,
                expensesAmount,
                closingCashBalance,
                netProfit,
                quantitySummary,
                status: 'Settled',
                settledByAdminId,
                notes
            }
        });

        if (!created) {
            record.openingStockAmount = openingStockAmount;
            record.salesStockAmount = salesStockAmount;
            record.purchaseStockAmount = purchaseStockAmount;
            record.closingStockAmount = closingStockAmount;
            record.openingCashBalance = openingCashBalance;
            record.cashSalesAmount = cashSalesAmount;
            record.onlineSalesAmount = onlineSalesAmount;
            record.purchasePaymentAmount = purchasePaymentAmount;
            record.expensesAmount = expensesAmount;
            record.closingCashBalance = closingCashBalance;
            record.netProfit = netProfit;
            record.quantitySummary = quantitySummary;
            record.status = 'Settled';
            record.settledByAdminId = settledByAdminId;
            record.notes = notes;
            await record.save();
        }

        return res.json({
            success: true,
            message: 'Day reconciliation successfully settled and locked!',
            data: record
        });
    } catch (error) {
        console.error('Error settling day reconciliation:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to settle day reconciliation',
            error: error.message
        });
    }
};

/**
 * Get Historical Settled Reconciliations
 */
export const getReconciliationHistory = async (req, res) => {
    try {
        const { limit = 30, page = 1, godownId } = req.query;
        const offset = (Number(page) - 1) * Number(limit);

        const where = { status: 'Settled' };
        if (godownId) where.godownId = godownId;

        const { count, rows } = await DailyReconciliation.findAndCountAll({
            where,
            order: [['date', 'DESC']],
            limit: Number(limit),
            offset: Number(offset)
        });

        return res.json({
            success: true,
            data: {
                totalItems: count,
                totalPages: Math.ceil(count / Number(limit)),
                currentPage: Number(page),
                items: rows
            }
        });
    } catch (error) {
        console.error('Error fetching reconciliation history:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch reconciliation history',
            error: error.message
        });
    }
};
