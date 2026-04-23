import { Op } from 'sequelize';
import VendorOrder from '../../models/superadmin-models/VendorOrder.js';
import Vendor from '../../models/superadmin-models/Vendor.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import Volume from '../../models/superadmin-models/Volume.js';
import { getPaginationOptions } from '../../helpers/query.helper.js';

// ─── Auto-generate order number ──────────────────────────────────────────────
async function generateOrderNo() {
    const lastOrder = await VendorOrder.findOne({
        order: [['createdAt', 'DESC']],
        attributes: ['orderNo'],
    });

    if (!lastOrder) return 'VO-00001';

    const lastNo = parseInt(lastOrder.orderNo.split('-')[1]);
    const nextNo = (lastNo + 1).toString().padStart(5, '0');
    return `VO-${nextNo}`;
}

// ─── Enrich items: attach productName, volume, unitLabel for display ──────────
async function enrichItems(rawItems) {
    return await Promise.all(rawItems.map(async (item) => {
        let productName = item.productName || '';
        let volume = item.volume || '';
        let unitLabel = item.unitLabel || '';

        // Only enrich if names are missing
        if (!productName && item.productId) {
            const prod = await Product.findByPk(item.productId, { attributes: ['id', 'name'] });
            if (prod) {
                productName = prod.name?.en || Object.values(prod.name || {})[0] || '';
            }
        }
        if (!volume && item.variantId) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                attributes: ['id', 'volume', 'baseUnitLabel'],
            });
            if (variant) {
                volume = variant.volume || '';
                let rawLabel = variant.baseUnitLabel || '';

                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(rawLabel)) {
                    const volRecord = await Volume.findByPk(rawLabel, { attributes: ['id', 'name'] });
                    if (volRecord && volRecord.name) {
                        rawLabel = volRecord.name.en || Object.values(volRecord.name)[0] || rawLabel;
                    }
                }
                unitLabel = rawLabel;
            }
        }

        // Final PDF-safe cleaning
        const cleanForPDF = (text) => {
            if (!text) return '';
            let s = String(text)
                .replace(/મિલીલીટર/g, 'ml')
                .replace(/લીટર/g, 'Litre')
                .replace(/ગ્રામ/g, 'gm')
                .replace(/કિલોગ્રામ/g, 'kg')
                .replace(/નંગ/g, 'pcs')
                .replace(/કાર્ટૂન/g, 'Cartoon');
            return s.replace(/[^\x00-\x7F]/g, "").trim();
        };

        return {
            productId: item.productId,
            productName: cleanForPDF(productName),
            variantId: item.variantId,
            volume: cleanForPDF(volume),
            unitLabel: cleanForPDF(unitLabel),
            qty: Number(item.qty),
        };
    }));
}

// ─── Controllers ─────────────────────────────────────────────────────────────

export const createVendorOrder = async (req, res) => {
    try {
        const { vendorId, status, note, items } = req.body;

        if (!vendorId || !items || items.length === 0) {
            return res.status(400).json({ message: 'Vendor and items are required' });
        }

        const enrichedItems = await enrichItems(items);
        const totalItems = enrichedItems.reduce((s, i) => s + i.qty, 0);
        const orderNo = await generateOrderNo();

        const order = await VendorOrder.create({
            orderNo,
            vendorId,
            status: status || 'Pending',
            note: note || null,
            items: enrichedItems,
            totalItems,
        });

        const result = await VendorOrder.findByPk(order.id, {
            include: [{ model: Vendor, as: 'vendor' }],
        });

        res.status(201).json({
            status: 'success',
            message: 'Vendor order created successfully',
            data: result
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getAllVendorOrders = async (req, res) => {
    try {
        const { limit, offset, page } = getPaginationOptions(req.query);
        const { search, status } = req.query;

        const where = {};
        if (status) where.status = status;

        const vendorInclude = {
            model: Vendor,
            as: 'vendor',
            where: {},
            required: false,
        };

        if (search) {
            where[Op.or] = [
                { orderNo: { [Op.iLike]: `%${search}%` } },
                { '$vendor.name$': { [Op.iLike]: `%${search}%` } },
                { '$vendor.companyName$': { [Op.iLike]: `%${search}%` } },
            ];
            vendorInclude.required = true;
        }

        const { count, rows: orders } = await VendorOrder.findAndCountAll({
            where,
            include: [vendorInclude],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true,
        });

        res.status(200).json({
            status: 'success',
            data: {
                data: orders,
                pagination: {
                    totalRecords: count,
                    totalPages: Math.ceil(count / limit),
                    currentPage: page,
                }
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const getVendorOrderById = async (req, res) => {
    try {
        const order = await VendorOrder.findByPk(req.params.id, {
            include: [{ model: Vendor, as: 'vendor' }],
        });
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.status(200).json({ status: 'success', data: order });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const updateVendorOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, note, items } = req.body;

        const order = await VendorOrder.findByPk(id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const updateData = {};
        if (status) updateData.status = status;
        if (note !== undefined) updateData.note = note;
        if (items) {
            const enrichedItems = await enrichItems(items);
            updateData.items = enrichedItems;
            updateData.totalItems = enrichedItems.reduce((s, i) => s + i.qty, 0);
        }

        await order.update(updateData);

        const result = await VendorOrder.findByPk(id, {
            include: [{ model: Vendor, as: 'vendor' }],
        });

        res.status(200).json({
            status: 'success',
            message: 'Order updated successfully',
            data: result
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteVendorOrder = async (req, res) => {
    try {
        const order = await VendorOrder.findByPk(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        await order.destroy();
        res.status(200).json({ status: 'success', message: 'Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
