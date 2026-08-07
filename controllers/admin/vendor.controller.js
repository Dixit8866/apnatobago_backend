import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import Vendor from '../../models/superadmin-models/Vendor.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

export const createVendor = async (req, res, next) => {
    try {
        const { name, companyName, email, whatsappNumber, phoneNumber, address, gstNumber, status, productIds, orderDays } = req.body;

        if (!name || !name.trim()) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Vendor name is required.');
        }

        // Auto-generate vendorId
        const count = await Vendor.count({ paranoid: false });
        const generatedId = `VEN-${(count + 1).toString().padStart(5, '0')}`;

        const vendor = await Vendor.create({
            name: name.trim(),
            vendorId: generatedId,
            companyName: companyName && companyName.trim() ? companyName.trim() : null,
            email: email && email.trim() ? email.trim() : null,
            whatsappNumber: whatsappNumber && whatsappNumber.trim() ? whatsappNumber.trim() : null,
            phoneNumber: phoneNumber && phoneNumber.trim() ? phoneNumber.trim() : null,
            address: address && address.trim() ? address.trim() : null,
            gstNumber: gstNumber && gstNumber.trim() ? gstNumber.trim() : null,
            status: status || 'Active',
            productIds: Array.isArray(productIds) ? productIds : [],
            orderDays: Array.isArray(orderDays) ? orderDays : [],
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Vendor created successfully.', vendor);
    } catch (error) {
        next(error);
    }
};

export const getAllVendors = async (req, res, next) => {
    try {
        const { page = 1, limit = 50, search = '', status } = req.query;
        const { limit: limitOptions, offset } = getPaginationOptions(req.query);

        const searchWhere = {};
        if (search) {
            searchWhere[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { companyName: { [Op.iLike]: `%${search}%` } },
                { whatsappNumber: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
            ];
        }

        const where = { ...searchWhere };
        if (status) {
            where.status = status;
        }

        // Parallel status counts (search-aware, not status-filtered, paranoid=false to include soft deleted if status counts require it, but since delete soft deletes them, we must check deleted count as paranoid false)
        const [totalCount, activeCount, inactiveCount, deletedCount] = await Promise.all([
            Vendor.count({ where: searchWhere }),
            Vendor.count({ where: { ...searchWhere, status: 'Active' } }),
            Vendor.count({ where: { ...searchWhere, status: 'Inactive' } }),
            Vendor.count({ where: { ...searchWhere, status: 'Deleted' } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        if (req.query.paginate === 'false') {
            const vendors = await Vendor.findAll({ where, order: [['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendors fetched successfully.', vendors);
        }

        const { count, rows } = await Vendor.findAndCountAll({
            where,
            limit: limitOptions,
            offset,
            order: [['createdAt', 'DESC']],
        });

        const responseData = formatPaginatedResponse({ count, rows }, page, limitOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendors fetched successfully.', {
            ...responseData,
            statusCounts
        });
    } catch (error) {
        next(error);
    }
};

export const getVendorById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const vendor = await Vendor.findByPk(id);

        if (!vendor) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Vendor not found.');
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendor fetched successfully.', vendor);
    } catch (error) {
        next(error);
    }
};

export const updateVendor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, companyName, email, whatsappNumber, phoneNumber, address, gstNumber, status, productIds, orderDays } = req.body;

        const vendor = await Vendor.findByPk(id);
        if (!vendor) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Vendor not found.');
        }

        await vendor.update({
            name: name && name.trim() ? name.trim() : vendor.name,
            companyName: companyName !== undefined ? (companyName && companyName.trim() ? companyName.trim() : null) : vendor.companyName,
            email: email !== undefined ? (email && email.trim() ? email.trim() : null) : vendor.email,
            whatsappNumber: whatsappNumber !== undefined ? (whatsappNumber && whatsappNumber.trim() ? whatsappNumber.trim() : null) : vendor.whatsappNumber,
            phoneNumber: phoneNumber !== undefined ? (phoneNumber && phoneNumber.trim() ? phoneNumber.trim() : null) : vendor.phoneNumber,
            address: address !== undefined ? (address && address.trim() ? address.trim() : null) : vendor.address,
            gstNumber: gstNumber !== undefined ? (gstNumber && gstNumber.trim() ? gstNumber.trim() : null) : vendor.gstNumber,
            status: status || vendor.status,
            productIds: Array.isArray(productIds) ? productIds : vendor.productIds,
            orderDays: Array.isArray(orderDays) ? orderDays : vendor.orderDays,
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendor updated successfully.', vendor);
    } catch (error) {
        next(error);
    }
};

export const deleteVendor = async (req, res, next) => {
    try {
        const { id } = req.params;
        const vendor = await Vendor.findByPk(id);

        if (!vendor) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Vendor not found.');
        }

        await vendor.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendor deleted successfully.');
    } catch (error) {
        next(error);
    }
};

export const getVendorAnalytics = async (req, res, next) => {
    try {
        const { id } = req.params;
        const vendor = await Vendor.findByPk(id);
        if (!vendor) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Vendor not found.');

        // Get all orders for this vendor
        const orders = await sequelize.models.VendorOrder.findAll({
            where: { vendorId: id },
            order: [['createdAt', 'DESC']]
        });

        const receivedOrders = orders.filter(o => o.status === 'Received');
        const totalBills = receivedOrders.length;
        
        // Calculate items frequency
        const itemFrequency = {};
        receivedOrders.forEach(order => {
            (order.items || []).forEach(it => {
                const key = `${it.productName} (${it.volume || ''})`;
                itemFrequency[key] = (itemFrequency[key] || 0) + (Number(it.qty) || 0);
            });
        });

        const mostlyBoughtItems = Object.entries(itemFrequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, qty]) => ({ name, qty }));

        // Mocking some financial stats until PurchaseBills are fully linked
        const analytics = {
            vendor: {
                name: vendor.name,
                vendorId: vendor.vendorId,
                companyName: vendor.companyName,
                whatsappNumber: vendor.whatsappNumber,
            },
            stats: {
                totalPurchases: totalBills * 5000, 
                totalBills,
                avgBillValue: totalBills > 0 ? 5000 : 0,
                totalPayable: totalBills * 1200, 
                preferredPaymentMethod: 'Bank Transfer',
                mostlyBoughtItems,
            },
            recentOrders: orders.slice(0, 20)
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Vendor analytics fetched.', analytics);
    } catch (error) {
        next(error);
    }
};
