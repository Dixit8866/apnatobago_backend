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
import Volume from '../../models/superadmin-models/Volume.js';
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

/**
 * Report: Cancelled/Delivered Orders
 */
export const getOrderReport = async (req, res, next) => {
    try {
        const { status = 'Cancelled', startDate, endDate } = req.query;
        const where = { orderStatus: status };
        if (startDate && endDate) {
            where.createdAt = { [Op.between]: [new Date(startDate + ' 00:00:00'), new Date(endDate + ' 23:59:59')] };
        }

        const orders = await Order.findAll({
            where,
            include: [{ model: User, as: 'user', attributes: ['id', 'fullname', 'number'] }],
            order: [['createdAt', 'DESC']]
        });

        const reportData = orders.map(o => ({
            'Order ID': o.orderId,
            'Customer': o.user?.fullname || 'Unknown',
            'Phone': o.user?.number || '-',
            'Total Amount': o.totalAmount,
            'Status': o.orderStatus,
            'Date': o.createdAt.toLocaleDateString()
        }));

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
            where.createdAt = { [Op.between]: [new Date(startDate + ' 00:00:00'), new Date(endDate + ' 23:59:59')] };
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
            'Product': i.product?.name?.en || 'Unnamed',
            'Total Quantity': i.getDataValue('totalQty'),
            'Total Revenue': i.getDataValue('totalRevenue')
        }));

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
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
            'Product': s.product?.name?.en || 'Unnamed',
            'Volume': s.variant?.volume || '-',
            'Available Stock': s.totalBaseUnits,
            'Alert Level': 10
        }));

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
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
            where.createdAt = { [Op.between]: [new Date(startDate + ' 00:00:00'), new Date(endDate + ' 23:59:59')] };
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

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
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
            where.createdAt = { [Op.between]: [new Date(startDate), new Date(endDate)] };
        }

        const bills = await PurchaseBill.findAll({
            where,
            include: [{ model: Product, as: 'product', attributes: ['name'] }],
            order: [['createdAt', 'DESC']]
        });

        const reportData = bills.map(b => ({
            'Bill ID': b.billId,
            'Product': b.product?.name?.en || 'Unnamed',
            'Quantity': b.quantity,
            'Total Amount': b.totalAmount,
            'Date': b.createdAt.toLocaleDateString()
        }));

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
            'Product': s.product?.name?.en || 'Unnamed',
            'Variant': s.variant?.volume || '-',
            'Stock Count': s.totalBaseUnits,
            'Expiry Date': s.expiryDate ? s.expiryDate.toLocaleDateString() : 'N/A',
            'Batch': s.batchNumber || '-',
            'Total Value': Number(s.totalBaseUnits) * Number(s.avgPurchasePricePerBaseUnit)
        }));

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
                    'Product Name': p.name?.en || 'Unnamed',
                    'Volume': v.volume,
                    'Purchase Price': v.purchasePrice,
                    'Status': v.status
                });
            }
        }

        if (req.query.format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            return res.status(200).send(jsonToCsv(reportData));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product master report fetched.', reportData);
    } catch (error) {
        next(error);
    }
};
