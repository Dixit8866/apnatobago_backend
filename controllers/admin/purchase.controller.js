import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { PurchaseBill, VendorOrder, InventoryStock, InventoryTransaction, ProductVariant, Product, Godown, Admin, Vendor, ProductPricing } from '../../models/index.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { generatePurchaseBill } from '../../utils/invoiceGenerator.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';
import stockService from '../../services/stock.service.js';

export const convertToBill = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { vendorOrderId, godownId, items, note } = req.body;

        const receivedDate = req.body.receivedDate || req.body.date || new Date();
        const receivedBy = req.body.receivedBy || req.body.receivedById || req.admin?.id || null;

        const order = await VendorOrder.findByPk(vendorOrderId, { transaction: t });
        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Vendor Order not found');
        }
        if (order.isConverted) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'This order has already been converted to a bill');
        }

        // Filter items to ensure only items with qty > 0 are saved in bill & inventory
        const validItems = (items || []).filter(item => {
            const q = item.receivedQty !== undefined ? Number(item.receivedQty) : Number(item.qty);
            return q > 0;
        });

        const billItems = validItems.length > 0 ? validItems : items;

        // 1. Create Purchase Bill
        const billNo = req.body.billNo || `PB-${Date.now().toString().slice(-6)}${Math.floor(1000 + Math.random() * 9000)}`;
        const totalAmount = billItems.reduce((sum, item) => {
            const q = item.receivedQty !== undefined ? Number(item.receivedQty) : Number(item.qty);
            return sum + (Number(item.purchasePrice || 0) * q);
        }, 0);

        const bill = await PurchaseBill.create({
            billNo,
            vendorOrderId,
            vendorId: order.vendorId,
            receivedDate,
            receivedBy: receivedBy || order.createdBy || req.admin?.id,
            godownId,
            items: billItems,
            totalAmount,
            note: note || req.body.notes
        }, { transaction: t });

        // 2. Update Vendor Order and sync totalAmount
        await order.update({ isConverted: true, status: 'Received', totalAmount }, { transaction: t });

        // 3. Stock + purchase rates + selling prices
        //    - every received line = one new lot at the bill rate (Stock Service, ledger entry)
        //    - "hold" ON + older stock in this godown → new selling prices wait on the lot and go live
        //      automatically when the older lots are sold out
        const olderStockByProduct = new Map();   // productId → base units in this godown before this bill
        const firstLotByProduct = new Map();     // productId → first lot created by this bill
        const heldPricesByProduct = new Map();   // productId → [{ variantId, purchasePrice, pricings }]
        const liveScopeProducts = new Set();     // held prices that should also update global (live) pricing
        const touchedProducts = new Set();

        for (const item of items) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                include: [{ model: Product, as: 'product' }],
                transaction: t
            });
            if (!variant) continue;
            touchedProducts.add(item.productId);

            const baseUnitsMultiplier = Number(variant.baseUnitsPerPack || 1);
            const receivedQty = item.receivedQty !== undefined ? Number(item.receivedQty) : Number(item.qty);
            const addedBaseUnits = Math.round(receivedQty * baseUnitsMultiplier);
            const itemPurchasePrice = Number(item.purchasePrice || 0);
            const hasPrice = itemPurchasePrice > 0;
            const pricings = Array.isArray(item.pricings) ? item.pricings.filter(p => p && p.customLevelId) : [];

            if (!olderStockByProduct.has(item.productId)) {
                const older = await InventoryStock.sum('totalBaseUnits', {
                    where: { productId: item.productId, godownId, totalBaseUnits: { [Op.gt]: 0 } },
                    transaction: t
                });
                olderStockByProduct.set(item.productId, Number(older || 0));
            }

            if (addedBaseUnits > 0) {
                // Same batch number cannot be reused for another volume / expiry of this product
                if (item.batchNumber) {
                    const existingBatch = await InventoryStock.findOne({
                        where: {
                            productId: item.productId,
                            batchNumber: item.batchNumber,
                            [Op.or]: [
                                { expiryDate: { [Op.ne]: item.expiryDate || null } },
                                { variantId: { [Op.ne]: item.variantId } }
                            ]
                        },
                        transaction: t
                    });
                    if (existingBatch) {
                        await t.rollback();
                        return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Batch number "${item.batchNumber}" already exists for this product with different variant or expiry date.`);
                    }
                }

                const { lot } = await stockService.receive({
                    productId: item.productId,
                    godownId,
                    variantId: item.variantId,
                    qtyBase: addedBaseUnits,
                    unitCost: hasPrice ? itemPurchasePrice / baseUnitsMultiplier : null,
                    movement: 'PURCHASE',
                    ref: { refType: 'PURCHASE_BILL', refId: bill.id, refNo: billNo },
                    note: note || `Purchase Bill ${billNo}`,
                    actor: req.user,
                    expiryDate: item.expiryDate || null,
                    batchNumber: item.batchNumber || null,
                    receivedAt: receivedDate,
                    skipHoldRefresh: true,
                }, t);
                if (!firstLotByProduct.has(item.productId)) firstLotByProduct.set(item.productId, lot);
            }

            const shouldUpdateLivePricing = !!item.updateLiveProductPricing;
            // LOCK ON = new prices wait until the old stock in this godown is sold out.
            // LIVE decides where they apply then: live = global + this godown, off = this godown only.
            const holdNewPrices = !!item.oldStockLockToggle && olderStockByProduct.get(item.productId) > 0;

            if (holdNewPrices) {
                // keep the new rate + prices on the lot; they go live when the older stock is sold out
                if (shouldUpdateLivePricing) liveScopeProducts.add(item.productId);
                if (hasPrice || pricings.length) {
                    if (!heldPricesByProduct.has(item.productId)) heldPricesByProduct.set(item.productId, []);
                    heldPricesByProduct.get(item.productId).push({
                        variantId: item.variantId,
                        purchasePrice: hasPrice ? itemPurchasePrice : null,
                        pricings: pricings.map(p => ({ ...p, purchasePrice: hasPrice ? itemPurchasePrice : p.purchasePrice }))
                    });
                }
                continue;
            }

            if (shouldUpdateLivePricing) {
                if (hasPrice) {
                    await ProductVariant.update(
                        {
                            purchasePrice: itemPurchasePrice,
                            ...(item.mrp ? { mrp: item.mrp } : {})
                        },
                        { where: { id: item.variantId }, transaction: t }
                    );
                }

                if (pricings.length > 0) {
                    // Update default global level pricing (godownId = null) and this godown's pricing
                    for (const scope of godownId ? [null, godownId] : [null]) {
                        await ProductPricing.destroy({
                            where: { variantId: item.variantId, godownId: scope },
                            transaction: t
                        });
                        for (const p of pricings) {
                            await ProductPricing.create({
                                variantId: item.variantId,
                                godownId: scope,
                                customLevelId: p.customLevelId,
                                quantityRange: `${p.minQty}-${p.maxQty}`,
                                minQty: p.minQty,
                                maxQty: p.maxQty,
                                purchasePrice: hasPrice ? itemPurchasePrice : (p.purchasePrice || 0),
                                price: p.price,
                                mrp: p.mrp || p.price,
                                status: 'Active'
                            }, { transaction: t });
                        }
                    }
                }
                continue;
            }

            // No hold: new rate + prices go live now (this godown's pricing, as before)
            if (hasPrice) {
                await ProductVariant.update(
                    { purchasePrice: itemPurchasePrice },
                    { where: { id: item.variantId }, transaction: t }
                );
            }
            if (pricings.length > 0) {
                await ProductPricing.destroy({
                    where: {
                        variantId: item.variantId,
                        ...(godownId ? { godownId } : { godownId: null })
                    },
                    transaction: t
                });

                for (const p of pricings) {
                    await ProductPricing.create({
                        variantId: item.variantId,
                        godownId: godownId || null,
                        customLevelId: p.customLevelId,
                        quantityRange: `${p.minQty}-${p.maxQty}`,
                        minQty: p.minQty,
                        maxQty: p.maxQty,
                        purchasePrice: hasPrice ? itemPurchasePrice : (p.purchasePrice || 0),
                        price: p.price,
                        mrp: p.mrp,
                        status: 'Active'
                    }, { transaction: t });
                }
            }
        }

        // Held prices: park them on this bill's first lot of the product (or apply now if nothing was received)
        for (const [productId, variantsSet] of heldPricesByProduct) {
            const lot = firstLotByProduct.get(productId);
            const pricingData = { billNo, billId: bill.id, scope: liveScopeProducts.has(productId) ? 'live' : 'godown', variants: variantsSet };
            if (lot) {
                await lot.update({ pricingData, pricingApplied: false }, { transaction: t });
            } else {
                await stockService.applyPricingSet(pricingData, godownId, t);
            }
        }
        for (const productId of touchedProducts) {
            await stockService.refreshHoldState(productId, t);
        }

        await t.commit();
        logActivity(req, {
            module: 'Purchase Bill',
            action: 'CREATE',
            description: `Converted Vendor Order to Purchase Bill #${bill?.billNo || billNo || 'Bill'}`,
            metadata: { billId: bill?.id, billNo: bill?.billNo || billNo, totalAmount: bill?.totalAmount }
        });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Order converted to Purchase Bill successfully', bill);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const getPurchaseBills = async (req, res, next) => {
    try {
        const { search, godownId } = req.query;
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const where = {};
        if (godownId) {
            where.godownId = godownId;
        }

        if (search && String(search).trim()) {
            const searchTrim = String(search).trim();
            where[Op.or] = [
                { billNo: { [Op.iLike]: `%${searchTrim}%` } },
                { '$vendor.name$': { [Op.iLike]: `%${searchTrim}%` } },
                { '$vendor.companyName$': { [Op.iLike]: `%${searchTrim}%` } },
                sequelize.literal(`"vendorOrder"."items"::text ILIKE ${sequelize.escape('%' + searchTrim + '%')}`)
            ];
        }

        const result = await PurchaseBill.findAndCountAll({
            where,
            include: [
                { model: Vendor, as: 'vendor', attributes: ['name', 'companyName'] },
                { model: Admin, as: 'receiver', attributes: ['name'] },
                { model: Godown, as: 'godown', attributes: ['name'] },
                { model: VendorOrder, as: 'vendorOrder', attributes: ['orderNo'] }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Purchase bills fetched successfully', responseData);
    } catch (error) {
        next(error);
    }
};

export const getPurchaseBillById = async (req, res, next) => {
    try {
        const bill = await PurchaseBill.findByPk(req.params.id, {
            include: [
                { model: Vendor, as: 'vendor' },
                { model: Admin, as: 'receiver', attributes: ['name'] },
                { model: Godown, as: 'godown', attributes: ['name'] },
                { model: VendorOrder, as: 'vendorOrder' }
            ]
        });
        if (!bill) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Purchase bill not found');
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Purchase bill fetched successfully', bill);
    } catch (error) {
        next(error);
    }
};
/**
 * @desc    Download Purchase Bill PDF
 * @route   GET /api/admin/purchase/bills/:id/download
 * @access  Private (Admin)
 */
export const downloadPurchaseBill = async (req, res, next) => {
    try {
        const { id } = req.params;
        const bill = await PurchaseBill.findByPk(id, {
            include: [
                { model: Vendor, as: 'vendor' },
                { model: Admin, as: 'receiver', attributes: ['name'] },
                { model: Godown, as: 'godown', attributes: ['name'] },
                { model: VendorOrder, as: 'vendorOrder', attributes: ['orderNo'] }
            ]
        });

        if (!bill) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Purchase bill not found');
        }

        const pdfBuffer = await generatePurchaseBill(bill);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=PurchaseBill-${bill.billNo}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error(`[Admin Purchase Bill Download Error]: ${error.message}`);
        next(error);
    }
};
