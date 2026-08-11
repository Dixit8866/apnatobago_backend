import { Op } from 'sequelize';
import VendorOrder from '../../models/superadmin-models/VendorOrder.js';
import Vendor from '../../models/superadmin-models/Vendor.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import Volume from '../../models/superadmin-models/Volume.js';
import PurchaseBill from '../../models/superadmin-models/PurchaseBill.js';
import Admin from '../../models/superadmin-models/Admin.js';
import Godown from '../../models/superadmin-models/Godown.js';
import { getPaginationOptions } from '../../helpers/query.helper.js';
import { generateVendorOrderInvoice } from '../../utils/invoiceGenerator.js';

// ─── Auto-generate order number ──────────────────────────────────────────────
async function generateOrderNo() {
    const lastOrder = await VendorOrder.findOne({
        order: [['createdAt', 'DESC']],
        attributes: ['orderNo'],
        paranoid: false,
    });

    if (!lastOrder) return 'VO-00001';

    const parts = lastOrder.orderNo.split('-');
    const lastNo = parseInt(parts[1] || '0');
    const nextNo = (lastNo + 1).toString().padStart(5, '0');
    return `VO-${nextNo}`;
}

// ─── Helper to ensure full product name on existing items ─────────────────────
export async function ensureItemProductNames(items) {
    if (!Array.isArray(items) || items.length === 0) return items;

    const productIdsToFetch = items
        .filter(it => it.productId && (!it.productName || it.productName.trim().length <= 5 || !it.productName.includes(' ')))
        .map(it => it.productId);

    if (productIdsToFetch.length === 0) return items;

    try {
        const products = await Product.findAll({
            where: { id: productIdsToFetch },
            attributes: ['id', 'name']
        });
        const productMap = new Map(products.map(p => [p.id, p]));

        return items.map(it => {
            const prod = productMap.get(it.productId);
            let fullName = it.productName;
            if (prod && prod.name) {
                const fetchedName = prod.name?.en || prod.name?.gu || Object.values(prod.name || {})[0] || '';
                if (fetchedName && fetchedName.trim()) {
                    fullName = fetchedName;
                }
            }
            return {
                ...it,
                productName: fullName || it.productName || 'Product'
            };
        });
    } catch (err) {
        console.error("Error in ensureItemProductNames:", err);
        return items;
    }
}

// ─── Enrich items: attach productName, volume, unitLabel for display ──────────
async function enrichItems(rawItems) {
    return await Promise.all(rawItems.map(async (item) => {
        try {
            let productName = item.productName || '';
            let volume = item.volume || '';
            let unitLabel = item.unitLabel || '';

            // Always fetch Product to guarantee full product name
            if (item.productId) {
                const prod = await Product.findByPk(item.productId, { attributes: ['id', 'name'] });
                if (prod && prod.name) {
                    const fullName = prod.name?.en || prod.name?.gu || Object.values(prod.name || {})[0] || '';
                    if (fullName && fullName.trim()) {
                        productName = fullName;
                    }
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

            const cleanText = (text) => {
                if (!text) return '';
                return String(text)
                    .replace(/મિલીલીટર/g, 'ml')
                    .replace(/લીટર/g, 'Litre')
                    .replace(/ગ્રામ/g, 'gm')
                    .replace(/કિલોગ્રામ/g, 'kg')
                    .replace(/નંગ/g, 'pcs')
                    .replace(/કાર્ટૂન/g, 'Cartoon')
                    .trim();
            };

            return {
                productId: item.productId,
                productName: cleanText(productName),
                variantId: item.variantId,
                volume: cleanText(volume),
                unitLabel: cleanText(unitLabel),
                quotationPrice: item.quotationPrice !== undefined && item.quotationPrice !== null ? Number(item.quotationPrice) : null,
                qty: Number(item.qty),
            };
        } catch (err) {
            console.error("ERROR ENRICHING ITEM DETAIL IN VENDOR ORDER CONTROLLER:", item, err);
            throw err;
        }
    }));
}

// ─── Controllers ─────────────────────────────────────────────────────────────

export const createVendorOrder = async (req, res) => {
    try {
        const { vendorId, status, note, items, receivedOrderDate } = req.body;

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
            receivedOrderDate: receivedOrderDate || null,
            items: enrichedItems,
            totalItems,
        });

        // Auto-link any new products in items to the Vendor's productIds
        if (vendorId && items && items.length > 0) {
            try {
                const vendor = await Vendor.findByPk(vendorId);
                if (vendor) {
                    const currentProductIds = Array.isArray(vendor.productIds) ? vendor.productIds : [];
                    const orderProductIds = items.map(i => i.productId).filter(Boolean);
                    const combinedProductIds = Array.from(new Set([...currentProductIds, ...orderProductIds]));

                    if (combinedProductIds.length > currentProductIds.length) {
                        await vendor.update({ productIds: combinedProductIds });
                    }
                }
            } catch (err) {
                console.error("Failed to auto-link products to vendor:", err);
            }
        }

        const result = await VendorOrder.findByPk(order.id, {
            include: [{ model: Vendor, as: 'vendor' }],
        });

        res.status(201).json({
            status: 'success',
            message: 'Vendor order created successfully',
            data: result
        });
    } catch (error) {
        console.error("ERROR IN CREATE VENDOR ORDER CONTROLLER:", error);
        res.status(500).json({ message: error.message });
    }
};

export const getAllVendorOrders = async (req, res) => {
    try {
        const { limit, offset, page } = getPaginationOptions(req.query);
        const { search, status, today } = req.query;
        const where = {};

        if (status) where.status = status;

        if (today === 'true') {
            const startOfDay = new Date();
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date();
            endOfDay.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
        }

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
            include: [
                vendorInclude,
                {
                    model: PurchaseBill,
                    as: 'bill',
                    attributes: ['id', 'billNo', 'receivedDate', 'receivedBy', 'godownId', 'totalAmount'],
                    include: [
                        { model: Admin, as: 'receiver', attributes: ['id', 'name'] },
                        { model: Godown, as: 'godown', attributes: ['id', 'name'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit,
            offset,
            distinct: true,
        });

        // ─── Status Counts ───────────────────────────────────────────────────
        const startToday = new Date();
        startToday.setHours(0, 0, 0, 0);
        const endToday = new Date();
        endToday.setHours(23, 59, 59, 999);

        const statusCounts = {
            Today: await VendorOrder.count({ where: { createdAt: { [Op.between]: [startToday, endToday] } } }),
            Pending: await VendorOrder.count({ where: { status: 'Pending' } }),
            Received: await VendorOrder.count({ where: { status: 'Received' } }),
            Cancelled: await VendorOrder.count({ where: { status: 'Cancelled' } }),
        };

        res.status(200).json({
            status: 'success',
            data: {
                data: orders,
                statusCounts,
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
            include: [
                { model: Vendor, as: 'vendor' },
                {
                    model: PurchaseBill,
                    as: 'bill',
                    attributes: ['id', 'billNo', 'receivedDate', 'receivedBy', 'godownId', 'totalAmount'],
                    include: [
                        { model: Admin, as: 'receiver', attributes: ['id', 'name'] },
                        { model: Godown, as: 'godown', attributes: ['id', 'name'] }
                    ]
                }
            ],
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
        const { status, note, items, receivedOrderDate } = req.body;

        const order = await VendorOrder.findByPk(id);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const updateData = {};
        if (status) updateData.status = status;
        if (note !== undefined) updateData.note = note;
        if (receivedOrderDate !== undefined) updateData.receivedOrderDate = receivedOrderDate || null;
        if (items) {
            const enrichedItems = await enrichItems(items);
            updateData.items = enrichedItems;
            updateData.totalItems = enrichedItems.reduce((s, i) => s + i.qty, 0);
        }

        await order.update(updateData);

        // Update ProductVariant purchase prices and ProductPricing selling prices in DB if edited in variantsData
        if (items && Array.isArray(items)) {
            for (const item of items) {
                if (item.variantsData && Array.isArray(item.variantsData)) {
                    for (const vData of item.variantsData) {
                        if (vData.variantId) {
                            const pVal = Number(vData.purchasePrice);
                            if (!isNaN(pVal) && pVal > 0) {
                                await ProductVariant.update(
                                    { purchasePrice: pVal },
                                    { where: { id: vData.variantId } }
                                );
                            }

                            if (vData.pricings && Array.isArray(vData.pricings)) {
                                for (const p of vData.pricings) {
                                    const prcVal = Number(p.price);
                                    if (p.customLevelId && !isNaN(prcVal) && prcVal > 0) {
                                        const existingP = await ProductPricing.findOne({
                                            where: {
                                                variantId: vData.variantId,
                                                customLevelId: p.customLevelId
                                            }
                                        });
                                        if (existingP) {
                                            await existingP.update({ price: prcVal });
                                        } else {
                                            await ProductPricing.create({
                                                productId: item.productId,
                                                variantId: vData.variantId,
                                                customLevelId: p.customLevelId,
                                                minQty: p.minQty || 1,
                                                maxQty: p.maxQty || 99,
                                                price: prcVal,
                                                mrp: p.mrp || 0
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Auto-link any new products in items to the Vendor's productIds
        if (items && order.vendorId) {
            try {
                const vendor = await Vendor.findByPk(order.vendorId);
                if (vendor) {
                    const currentProductIds = Array.isArray(vendor.productIds) ? vendor.productIds : [];
                    const orderProductIds = items.map(i => i.productId).filter(Boolean);
                    const combinedProductIds = Array.from(new Set([...currentProductIds, ...orderProductIds]));

                    if (combinedProductIds.length > currentProductIds.length) {
                        await vendor.update({ productIds: combinedProductIds });
                    }
                }
            } catch (err) {
                console.error("Failed to auto-link products to vendor in update:", err);
            }
        }

        const result = await VendorOrder.findByPk(id, {
            include: [{ model: Vendor, as: 'vendor' }],
        });

        res.status(200).json({
            status: 'success',
            message: 'Order updated successfully',
            data: result
        });
    } catch (error) {
        console.error("ERROR IN UPDATE VENDOR ORDER CONTROLLER:", error);
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

export const downloadVendorOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await VendorOrder.findByPk(id, {
            include: [{ model: Vendor, as: 'vendor' }]
        });

        if (!order) {
            return res.status(404).json({ message: 'Vendor order not found' });
        }

        const pdfBuffer = await generateVendorOrderInvoice(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=VendorOrder-${order.orderNo}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        console.error(`[Admin Vendor Order Download Error]: ${error.message}`);
        res.status(500).json({ message: error.message });
    }
};
