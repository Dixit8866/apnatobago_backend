import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { PurchaseBill, VendorOrder, InventoryStock, InventoryTransaction, ProductVariant, Product, Godown, Admin, Vendor } from '../../models/index.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';

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

        // 1. Create Purchase Bill
        const billNo = `PB-${Date.now()}`;
        const totalAmount = items.reduce((sum, item) => sum + (Number(item.purchasePrice) * Number(item.qty)), 0);

        const bill = await PurchaseBill.create({
            billNo,
            vendorOrderId,
            vendorId: order.vendorId,
            receivedDate,
            receivedBy,
            godownId,
            items,
            totalAmount,
            note
        }, { transaction: t });

        // 2. Update Vendor Order
        await order.update({ isConverted: true, status: 'Received' }, { transaction: t });

        // 3. Update Inventory
        for (const item of items) {
            const variant = await ProductVariant.findByPk(item.variantId, { 
                include: [{ model: Product, as: 'product' }],
                transaction: t 
            });
            if (!variant) continue;

            // Find or create stock entry for this variant in this godown
            let stock = await InventoryStock.findOne({
                where: { productId: item.productId, variantId: item.variantId, godownId },
                transaction: t
            });

            // Smarter multiplier: Use baseUnitsPerPack, but if it's 1 and volume contains a number (e.g. 250 ml), use that number as multiplier.
            let baseUnitsMultiplier = Number(variant.baseUnitsPerPack || 1);
            if (baseUnitsMultiplier === 1 && variant.volume) {
                const match = variant.volume.match(/(\d+)/);
                if (match) {
                    baseUnitsMultiplier = Number(match[0]);
                }
            }

            const addedBaseUnits = Number(item.qty) * baseUnitsMultiplier;
            const purchasePricePerBaseUnit = Number(item.purchasePrice) / baseUnitsMultiplier;

            if (!stock) {
                stock = await InventoryStock.create({
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId,
                    primaryUnitId: variant.volumeId, // Using volumeId as primaryUnitId
                    totalBaseUnits: addedBaseUnits,
                    avgPurchasePricePerBaseUnit: purchasePricePerBaseUnit,
                    lastPurchasePricePerBaseUnit: purchasePricePerBaseUnit
                }, { transaction: t });
            } else {
                const currentTotalUnits = Number(stock.totalBaseUnits || 0);
                const currentAvgPrice = Number(stock.avgPurchasePricePerBaseUnit || 0);
                const newTotalUnits = currentTotalUnits + addedBaseUnits;
                
                // Calculate new average price
                const newAvgPrice = newTotalUnits > 0 
                    ? ((currentAvgPrice * currentTotalUnits) + (purchasePricePerBaseUnit * addedBaseUnits)) / newTotalUnits
                    : purchasePricePerBaseUnit;

                await stock.update({
                    totalBaseUnits: newTotalUnits,
                    avgPurchasePricePerBaseUnit: newAvgPrice,
                    lastPurchasePricePerBaseUnit: purchasePricePerBaseUnit
                }, { transaction: t });
            }

            // Create Inventory Transaction
            await InventoryTransaction.create({
                stockId: stock.id,
                productId: item.productId,
                variantId: item.variantId,
                godownId,
                type: 'PURCHASE',
                primaryUnitId: variant.volumeId,
                qtyPrimary: item.qty,
                totalQtyBaseUnits: addedBaseUnits,
                purchasePricePerBaseUnit: purchasePricePerBaseUnit,
                avgPriceAfterTxn: stock.avgPurchasePricePerBaseUnit,
                balanceAfterBaseUnits: stock.totalBaseUnits,
                note: `Purchase Bill ${billNo}`
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
        const bills = await PurchaseBill.findAll({
            include: [
                { model: Vendor, as: 'vendor', attributes: ['name', 'companyName'] },
                { model: Admin, as: 'receiver', attributes: ['name'] },
                { model: Godown, as: 'godown', attributes: ['name'] },
                { model: VendorOrder, as: 'vendorOrder', attributes: ['orderNo'] }
            ],
            order: [['createdAt', 'DESC']]
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Purchase bills fetched successfully', bills);
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
