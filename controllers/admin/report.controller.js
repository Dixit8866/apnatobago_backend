import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import Order from '../../models/user/Order.js';
import OrderItem from '../../models/user/OrderItem.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import InventoryStock from '../../models/superadmin-models/InventoryStock.js';
import PurchaseBill from '../../models/superadmin-models/PurchaseBill.js';
import User from '../../models/user/User.js';
import BusinessProfile from '../../models/user/BusinessProfile.js';
import OrderPayment from '../../models/user/OrderPayment.js';
import DeliveryBoy from '../../models/superadmin-models/DeliveryBoy.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';

// Helper for CSV generation
const jsonToCsv = (items) => {
    if (!items.length) return '';
    const header = Object.keys(items[0]).join(',');
    const rows = items.map(row => 
        Object.values(row).map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')
    );
    return [header, ...rows].join('\n');
};

// Helper for Excel (XLS) generation
const jsonToXls = (items) => {
    if (!items.length) return '';
    const keys = Object.keys(items[0]);
    let html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Report</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table border="1"><thead><tr style="background-color: #f2f2f2; font-weight: bold;">`;
    keys.forEach(key => {
        html += `<th>${key}</th>`;
    });
    html += `</tr></thead><tbody>`;
    items.forEach(row => {
        html += `<tr>`;
        Object.values(row).forEach(val => {
            html += `<td>${val !== null && val !== undefined ? String(val) : ''}</td>`;
        });
        html += `</tr>`;
    });
    html += `</tbody></table></body></html>`;
    return html;
};

/**
 * Report: Cancelled/Delivered Orders
 */
export const getOrderReport = async (req, res, next) => {
    try {
        const { status = 'Cancelled', startDate, endDate } = req.query;
        
        let statusList = [status];
        if (status === 'Cancelled') {
            statusList = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
        } else if (status === 'Delivered') {
            statusList = ['Delivered', 'Payment Collect', 'Payment Verify'];
        }

        const where = { orderStatus: { [Op.in]: statusList } };

        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);

            const dateField = status === 'Delivered' ? 'deliveredAt' : (status === 'Cancelled' ? 'updatedAt' : 'createdAt');
            if (dateField === 'deliveredAt') {
                where[Op.or] = [
                    { deliveredAt: { [Op.between]: [start, end] } },
                    { deliveredAt: null, updatedAt: { [Op.between]: [start, end] } }
                ];
            } else {
                where[dateField] = { [Op.between]: [start, end] };
            }
        }

        const orders = await Order.findAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'purchasePrice', 'baseUnitsPerPack'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        let grandPurchase = 0;
        let grandSales = 0;
        let grandProfit = 0;
        let grandTotalAmount = 0;

        const reportData = orders.map(o => {
            let totalPurchaseCost = 0;
            let totalSalesAmount = 0;

            if (o.items && o.items.length > 0) {
                o.items.forEach(item => {
                    const price = parseFloat(item.price || 0);
                    const qty = parseFloat(item.quantity || 0);
                    const itemSales = price * qty;
                    totalSalesAmount += itemSales;

                    const variant = item.variant;
                    const purchasePrice = parseFloat(variant?.purchasePrice || 0);
                    const bUPP = parseFloat(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);

                    let itemCost = 0;
                    if (item.sellUnit === 'Inner') {
                        itemCost = (purchasePrice / bUPP) * qty;
                    } else {
                        itemCost = purchasePrice * qty;
                    }
                    totalPurchaseCost += itemCost;
                });
            } else {
                totalSalesAmount = parseFloat(o.totalAmount || 0);
            }

            const sales = totalSalesAmount;
            const purchase = totalPurchaseCost;
            const profit = sales - purchase;
            const totalAmount = parseFloat(o.totalAmount || 0);

            grandPurchase += purchase;
            grandSales += sales;
            grandProfit += profit;
            grandTotalAmount += totalAmount;

            const shopName = o.user?.businessProfile?.shopName;
            const customerDisplay = shopName 
                ? `${o.user?.fullname || o.customerName || 'Unknown'} (${shopName})` 
                : (o.user?.fullname || o.customerName || 'Unknown');

            return {
                'Order ID': o.orderId,
                'Customer': customerDisplay,
                'Phone': o.user?.number || o.customerNumber || '-',
                'Purchase': purchase.toFixed(2),
                'Sales': sales.toFixed(2),
                'Profit': profit.toFixed(2),
                'Total Amount': totalAmount.toFixed(2),
                'Payment Method': o.paymentMethod || '-',
                'Status': o.orderStatus,
                'Date': (status === 'Delivered' ? (o.deliveredAt || o.updatedAt || o.createdAt) : (status === 'Cancelled' ? (o.updatedAt || o.createdAt) : o.createdAt)).toLocaleDateString()
            };
        });

        if (reportData.length > 0) {
            reportData.push({
                'Order ID': 'GRAND TOTAL',
                'Customer': '',
                'Phone': '',
                'Purchase': grandPurchase.toFixed(2),
                'Sales': grandSales.toFixed(2),
                'Profit': grandProfit.toFixed(2),
                'Total Amount': grandTotalAmount.toFixed(2),
                'Payment Method': '',
                'Status': '',
                'Date': ''
            });
        }

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', `attachment; filename=orders_${status}_report.xls`);
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=orders_${status}_report.csv`);
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Order report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Top Selling Products
 */
export const getTopSellingReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        const items = await OrderItem.findAll({
            attributes: [
                'productId',
                [sequelize.fn('SUM', sequelize.col('quantity')), 'totalQty'],
                [sequelize.fn('SUM', sequelize.col('totalPrice')), 'totalRevenue']
            ],
            where,
            group: ['productId', 'product.id'],
            include: [{ model: Product, as: 'product', attributes: ['name'] }],
            order: [[sequelize.literal('"totalQty"'), 'DESC']],
            limit: 50
        });

        const reportData = items.map(i => ({
            'Product': i.product?.name ? (i.product.name.en || Object.values(i.product.name)[0]) : 'Unnamed',
            'Total Quantity': i.getDataValue('totalQty'),
            'Total Revenue': i.getDataValue('totalRevenue')
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=top_selling_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=top_selling_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Top selling report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Low Stock Alerts
 */
export const getLowStockReport = async (req, res, next) => {
    try {
        const stocks = await InventoryStock.findAll({
            where: { totalBaseUnits: { [Op.lte]: 10 }, status: 'Active' },
            include: [
                { model: Product, as: 'product', attributes: ['name'] },
                { model: ProductVariant, as: 'variant', attributes: ['volume'] }
            ]
        });

        const reportData = stocks.map(s => ({
            'Product': s.product?.name ? (s.product.name.en || Object.values(s.product.name)[0]) : 'Unnamed',
            'Volume': s.variant?.volume || '-',
            'Available Stock': s.totalBaseUnits,
            'Alert Level': 10
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=low_stock_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=low_stock_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Low stock report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Party (User) Ledger/Summary
 */
export const getPartyReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        const users = await User.findAll({
            where,
            attributes: ['id', 'fullname', 'number', 'email', 'status', 'createdAt'],
            order: [['createdAt', 'DESC']]
        });

        const reportData = users.map(u => ({
            'Party Name': u.fullname,
            'Phone': u.number,
            'Email': u.email || '-',
            'Status': u.status,
            'Joined Date': u.createdAt.toLocaleDateString()
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=party_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=party_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Party report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Purchase Summary
 */
export const getPurchaseReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        const bills = await PurchaseBill.findAll({
            where,
            include: [{ model: Product, as: 'product', attributes: ['name'] }],
            order: [['createdAt', 'DESC']]
        });

        const reportData = bills.map(b => ({
            'Bill ID': b.billId,
            'Product': b.product?.name ? (b.product.name.en || Object.values(b.product.name)[0]) : 'Unnamed',
            'Quantity': b.quantity,
            'Total Amount': b.totalAmount,
            'Date': b.createdAt.toLocaleDateString()
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=purchase_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=purchase_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Purchase report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Inventory Detailed (with Expiry)
 */
export const getInventoryReport = async (req, res, next) => {
    try {
        const { type } = req.query; // 'all', 'low-stock', 'expiry'
        const where = { status: 'Active' };
        
        if (type === 'low-stock') {
            where.totalBaseUnits = { [Op.lte]: 10 };
        } else if (type === 'expiry') {
            const soon = new Date();
            soon.setMonth(soon.getMonth() + 3); // next 3 months
            where.expiryDate = { [Op.lte]: soon };
        }

        const stocks = await InventoryStock.findAll({
            where,
            include: [
                { model: Product, as: 'product', attributes: ['name'] },
                { model: ProductVariant, as: 'variant', attributes: ['volume'] }
            ],
            order: [['expiryDate', 'ASC']]
        });

        const reportData = stocks.map(s => ({
            'Product': s.product?.name ? (s.product.name.en || Object.values(s.product.name)[0]) : 'Unnamed',
            'Variant': s.variant?.volume || '-',
            'Stock Count': s.totalBaseUnits,
            'Expiry Date': s.expiryDate ? s.expiryDate.toLocaleDateString() : 'N/A',
            'Batch': s.batchNumber || '-',
            'Total Value': Number(s.totalBaseUnits) * Number(s.avgPurchasePricePerBaseUnit)
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', `attachment; filename=inventory_${type || 'all'}_report.xls`);
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=inventory_${type || 'all'}_report.csv`);
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Product Master
 */
export const getProductMasterReport = async (req, res, next) => {
    try {
        const products = await Product.findAll({
            include: [{ model: ProductVariant, as: 'variants' }]
        });

        const reportData = [];
        for (const p of products) {
            for (const v of (p.variants || [])) {
                reportData.push({
                    'Product Name': p.name ? (p.name.en || Object.values(p.name)[0]) : 'Unnamed',
                    'Volume': v.volume,
                    'Purchase Price': v.purchasePrice,
                    'Status': v.status
                });
            }
        }

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=product_master_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=product_master_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product master report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Payment Collection Summary
 */
export const getPaymentCollectionReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        const payments = await OrderPayment.findAll({
            where,
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['orderId', 'customerName', 'customerNumber'],
                    include: [
                        {
                            model: User,
                            as: 'user',
                            attributes: ['fullname', 'number']
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['name']
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        const reportData = payments.map(p => ({
            'Order ID': p.order?.orderId || '-',
            'Customer': p.order?.user?.fullname || p.order?.customerName || 'Unknown',
            'Phone': p.order?.user?.number || p.order?.customerNumber || '-',
            'Amount': p.amount,
            'Payment Method': p.paymentMethod,
            'Collected By': p.deliveryBoy?.name || 'Self/Online',
            'Status': p.isSubmitted ? 'Submitted' : 'Pending',
            'Date': p.createdAt.toLocaleDateString()
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=payment_collection_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=payment_collection_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Payment collection report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};

/**
 * Report: Payment Reconciliation
 */
export const getPaymentReconciliationReport = async (req, res, next) => {
    try {
        const { startDate, endDate } = req.query;
        const where = {};
        if (startDate && endDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [start, end] };
        }

        const orders = await Order.findAll({
            where,
            include: [{ model: User, as: 'user', attributes: ['id', 'fullname', 'number'] }],
            order: [['createdAt', 'DESC']]
        });

        const reportData = orders.map(o => ({
            'Order ID': o.orderId,
            'Customer': o.user?.fullname || o.customerName || 'Unknown',
            'Phone': o.user?.number || o.customerNumber || '-',
            'Total Amount': o.totalAmount,
            'Paid Amount': o.paidAmount,
            'Due Amount': o.dueAmount,
            'Payment Method': o.paymentMethod,
            'Payment Status': o.paymentStatus,
            'Order Status': o.orderStatus,
            'Date': o.createdAt.toLocaleDateString()
        }));

        if (req.query.format === 'excel') {
            res.setHeader('Content-Type', 'application/vnd.ms-excel');
            res.setHeader('Content-Disposition', 'attachment; filename=payment_reconciliation_report.xls');
            return res.status(200).send(jsonToXls(reportData));
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=payment_reconciliation_report.csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Payment reconciliation report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};
