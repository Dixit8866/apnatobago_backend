import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { PurchaseBill, VendorOrder, InventoryStock, InventoryTransaction, ProductVariant, Product, Godown, Admin, Vendor, ProductPricing } from '../../models/index.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { generatePurchaseBill } from '../../utils/invoiceGenerator.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

export const convertToBill = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { vendorOrderId, receivedDate, receivedBy, godownId, items, note } = req.body;

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
        const billNo = `PB-${Date.now().toString().slice(-6)}${Math.floor(1000 + Math.random() * 9000)}`;
        const totalAmount = billItems.reduce((sum, item) => {
            const q = item.receivedQty !== undefined ? Number(item.receivedQty) : Number(item.qty);
            return sum + (Number(item.purchasePrice || 0) * q);
        }, 0);

        const bill = await PurchaseBill.create({
            billNo,
            vendorOrderId,
            vendorId: order.vendorId,
            receivedDate,
            receivedBy,
            godownId,
            items: billItems,
            totalAmount,
            note
        }, { transaction: t });

        // 2. Update Vendor Order and sync totalAmount
        await order.update({ isConverted: true, status: 'Received', totalAmount }, { transaction: t });

        // 3. Update Inventory
        for (const item of billItems) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                include: [{ model: Product, as: 'product' }],
                transaction: t
            });
            if (!variant) continue;

            // Validation: Ensure same batch number isn't used for same product with different details
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

            // Find or create stock entry for this variant in this godown + expiryDate + batchNumber (Batch tracking)
            let stock = await InventoryStock.findOne({
                where: {
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId,
                    expiryDate: item.expiryDate || null,
                    batchNumber: item.batchNumber || null
                },
                transaction: t
            });

            // Fix: Use baseUnitsPerPack (e.g. 24) to convert outer units (Cartons) to base units (Pcs)
            const baseUnitsMultiplier = Number(variant.baseUnitsPerPack || 1);

            const receivedQty = item.receivedQty !== undefined ? Number(item.receivedQty) : Number(item.qty);
            const addedBaseUnits = receivedQty * baseUnitsMultiplier;
            const purchasePricePerBaseUnit = Number(item.purchasePrice) / baseUnitsMultiplier;

            // Fix: Use baseUnitLabel (Outer, e.g. Dando) as Primary
            // and innerUnitLabel (Inner, e.g. Box) as Secondary
            const primaryUnitId = variant.baseUnitLabel || variant.volumeId;
            const secondaryUnitId = variant.innerUnitLabel || variant.volumeId;

            if (!stock) {
                stock = await InventoryStock.create({
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId,
                    primaryUnitId,
                    secondaryUnitId,
                    secondaryPerPrimary: baseUnitsMultiplier,
                    totalBaseUnits: addedBaseUnits,
                    avgPurchasePricePerBaseUnit: purchasePricePerBaseUnit,
                    lastPurchasePricePerBaseUnit: purchasePricePerBaseUnit,
                    expiryDate: item.expiryDate || null,
                    batchNumber: item.batchNumber || null
                }, { transaction: t });
            } else {
                const currentTotalUnits = Number(stock.totalBaseUnits || 0);
                const currentAvgPrice = Number(stock.avgPurchasePricePerBaseUnit || 0);
                const newTotalUnits = currentTotalUnits + addedBaseUnits;

                // Calculate new average price
                const newAvgPrice = newTotalUnits > 0
                    ? ((currentAvgPrice * currentTotalUnits) + (purchasePricePerBaseUnit * addedBaseUnits)) / newTotalUnits
                    : purchasePricePerBaseUnit;

                // Update stock units and factor as well to ensure latest variant config is used
                await stock.update({
                    primaryUnitId,
                    secondaryUnitId,
                    secondaryPerPrimary: baseUnitsMultiplier,
                    totalBaseUnits: newTotalUnits,
                    avgPurchasePricePerBaseUnit: newAvgPrice,
                    lastPurchasePricePerBaseUnit: purchasePricePerBaseUnit
                }, { transaction: t });
            }

            const isLockEnabled = !!item.oldStockLockToggle;
            const oldStockLimitQty = isLockEnabled ? Number(item.oldStockLimitQty || 0) : 0;
            const newPricingsPayload = (isLockEnabled && item.pricings && Array.isArray(item.pricings)) ? item.pricings : null;

            if (isLockEnabled) {
                await ProductVariant.update(
                    {
                        purchasePrice: item.purchasePrice,
                        oldStockLockToggle: true,
                        oldStockLimitQty: oldStockLimitQty,
                        newPricingData: newPricingsPayload
                    },
                    { where: { id: item.variantId }, transaction: t }
                );
                // When Old Stock Lock Toggle is enabled, keep existing active ProductPricing intact
                // for the remaining old stock. New pricing will be automatically applied when old stock limit hits 0.
            } else {
                await ProductVariant.update(
                    {
                        purchasePrice: item.purchasePrice,
                        oldStockLockToggle: false,
                        oldStockLimitQty: 0,
                        newPricingData: null
                    },
                    { where: { id: item.variantId }, transaction: t }
                );

                // Update Level Wise Pricing immediately if provided
                if (item.pricings && Array.isArray(item.pricings) && item.pricings.length > 0) {
                    await ProductPricing.destroy({
                        where: { variantId: item.variantId },
                        transaction: t
                    });

                    for (const p of item.pricings) {
                        await ProductPricing.create({
                            variantId: item.variantId,
                            customLevelId: p.customLevelId,
                            quantityRange: `${p.minQty}-${p.maxQty}`,
                            minQty: p.minQty,
                            maxQty: p.maxQty,
                            purchasePrice: item.purchasePrice,
                            price: p.price,
                            mrp: p.mrp,
                            status: 'Active'
                        }, { transaction: t });
                    }
                }
            }

            // Create Inventory Transaction
            await InventoryTransaction.create({
                stockId: stock.id,
                productId: item.productId,
                variantId: item.variantId,
                godownId,
                type: 'PURCHASE',
                primaryUnitId,
                secondaryUnitId,
                secondaryPerPrimary: baseUnitsMultiplier,
                qtyPrimary: receivedQty, // E.g. 20 dando
                qtySecondary: 0,
                totalQtyBaseUnits: addedBaseUnits, // E.g. 400 box
                purchasePricePerBaseUnit: purchasePricePerBaseUnit,
                avgPriceAfterTxn: stock.avgPurchasePricePerBaseUnit,
                balanceAfterBaseUnits: stock.totalBaseUnits,
                note: note || `Purchase Bill ${billNo}`,
                createdBy: req.user?.name || 'Admin'
            }, { transaction: t });
        }

        await t.commit();
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

        if (search) {
            where[Op.or] = [
                { billNo: { [Op.iLike]: `%${search}%` } },
                { '$vendor.name$': { [Op.iLike]: `%${search}%` } },
                { '$vendor.companyName$': { [Op.iLike]: `%${search}%` } }
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
