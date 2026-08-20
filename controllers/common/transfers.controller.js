import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import {
    StockTransfer,
    StockTransferItem,
    InventoryStock,
    InventoryTransaction,
    Godown,
    Product,
    ProductVariant,
    ProductPricing,
    Volume
} from '../../models/index.js';

import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

export const getTransfers = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        let whereClause = {};

        // Restrict to staff's godown if not admin
        const isStaff = req.user && req.user.godownId;
        if (isStaff) {
            whereClause = {
                [Op.or]: [
                    { fromGodownId: req.user.godownId },
                    { toGodownId: req.user.godownId }
                ]
            };
        }

        if (status && status !== 'All') {
            whereClause.status = status;
        }

        if (search) {
            whereClause.transferNo = { [Op.iLike]: `%${search}%` };
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await StockTransfer.findAndCountAll({
            where: whereClause,
            include: [
                { model: Godown, as: 'fromGodown', attributes: ['id', 'name'] },
                { model: Godown, as: 'toGodown', attributes: ['id', 'name'] },
                { model: StockTransferItem, as: 'items', attributes: ['id'] }
            ],
            distinct: true,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Transfers retrieved successfully.', responseData);
    } catch (error) {
        next(error);
    }
};

export const getTransferById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const transfer = await StockTransfer.findByPk(id, {
            include: [
                { model: Godown, as: 'fromGodown', attributes: ['id', 'name'] },
                { model: Godown, as: 'toGodown', attributes: ['id', 'name'] },
                {
                    model: StockTransferItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'volumeId', 'extra', 'baseUnitLabel', 'innerUnitLabel'],
                            include: [
                                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!transfer) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Stock transfer not found.');
        }

        // Security check for godown staff
        const isStaff = req.user && req.user.godownId;
        if (isStaff && transfer.fromGodownId !== req.user.godownId && transfer.toGodownId !== req.user.godownId) {
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Access denied to this transfer.');
        }

        // Enrich items for the frontend view
        const enrichedItems = (transfer.items || []).map(item => {
            const prodName = item.product?.name?.en || item.product?.name?.gu || item.product?.name || 'Unknown Product';
            const variant = item.variant;
            const volumeUnit = variant?.volumeRef?.name?.en || variant?.volumeRef?.name?.gu || Object.values(variant?.volumeRef?.name || {})[0] || '';
            const volValue = variant?.volume || '';
            let volLabel = volValue;
            if (volumeUnit && volumeUnit !== '-') {
                if (!volValue.toLowerCase().includes(volumeUnit.toLowerCase())) {
                    volLabel = `${volValue} ${volumeUnit}`.trim();
                }
            }
            if (variant?.extra && String(variant.extra).trim()) {
                volLabel = `${String(variant.extra).trim()} ${volLabel}`;
            }

            const primaryUnit = variant?.baseUnitRef?.name?.en || variant?.baseUnitRef?.name?.gu || Object.values(variant?.baseUnitRef?.name || {})[0] || 'packs';

            return {
                id: item.id,
                productId: item.productId,
                variantId: item.variantId,
                productName: prodName,
                volume: volLabel || 'N/A',
                qty: item.qty,
                price: Number(item.price || 0),
                amount: Number(item.amount || 0),
                unitLabel: primaryUnit
            };
        });

        const data = {
            ...transfer.toJSON(),
            enrichedItems
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Transfer details retrieved successfully.', data);
    } catch (error) {
        next(error);
    }
};

export const createTransfer = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { fromGodownId, toGodownId, items, note } = req.body;

        if (!fromGodownId || !toGodownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Source and destination godowns are required.');
        }

        if (fromGodownId === toGodownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Source and destination godowns cannot be the same.');
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Transfer items are required.');
        }

        // Security check for godown staff
        const isStaff = req.user && req.user.godownId;
        if (isStaff && fromGodownId !== req.user.godownId && toGodownId !== req.user.godownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'You can only transfer stock to or from your own godown.');
        }

        // Generate unique transfer number
        const transferNo = `TRF-${Date.now()}`;

        // Create the transfer record
        const transfer = await StockTransfer.create({
            transferNo,
            fromGodownId,
            toGodownId,
            status: 'Pending',
            note,
            totalAmount: 0,
            createdBy: req.user?.name || req.user?.fullname || 'Staff'
        }, { transaction: t });

        let grandTotal = 0;

        // Add items
        for (const item of items) {
            const { productId, variantId, qty } = item;
            if (!productId || !variantId || !qty || qty <= 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid item quantity or product selection.');
            }

            const variant = await ProductVariant.findByPk(variantId, { transaction: t });
            const factor = Number(variant?.baseUnitsPerPack || 1);
            const qtyInBaseUnits = Number(qty) * factor;

            // Sum total available stock in source godown across all stock records
            const totalStockBaseUnits = parseFloat(await InventoryStock.sum('totalBaseUnits', {
                where: { productId, variantId, godownId: fromGodownId },
                transaction: t
            })) || 0;

            const maxAvailablePacks = totalStockBaseUnits / factor;

            if (totalStockBaseUnits < qtyInBaseUnits) {
                await t.rollback();
                const vol = variant ? variant.volume : '';
                return sendErrorResponse(
                    res,
                    HTTP_STATUS.BAD_REQUEST,
                    `Insufficient stock in source godown for variant ${vol || ''}. Available: ${maxAvailablePacks} packs`
                );
            }

            const price = Number(variant?.purchasePrice || 0);
            const amount = price * Number(qty);
            grandTotal += amount;

            await StockTransferItem.create({
                stockTransferId: transfer.id,
                productId,
                variantId,
                qty,
                price,
                amount
            }, { transaction: t });
        }
        // Update totalAmount of the transfer
        await transfer.update({ totalAmount: grandTotal }, { transaction: t });

        const fromGodown = await Godown.findByPk(fromGodownId);
        const toGodown = await Godown.findByPk(toGodownId);

        await t.commit();

        logActivity(req, {
            module: 'Stock Transfers',
            action: 'CREATE',
            description: `Created Stock Transfer #${transferNo} from ${fromGodown?.name || 'Godown'} to ${toGodown?.name || 'Godown'}`,
            metadata: { transferId: transfer.id, transferNo, fromGodownId, toGodownId }
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Stock transfer requested successfully.', transfer);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const updateTransferStatus = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;
        const { status } = req.body;

        const transfer = await StockTransfer.findByPk(id, {
            include: [{ model: StockTransferItem, as: 'items' }],
            transaction: t
        });

        if (!transfer) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Stock transfer not found.');
        }

        // Restrict duplicate transitions or changes to complete/cancelled transfers
        if (['Received', 'Cancelled'].includes(transfer.status)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Cannot modify status of a ${transfer.status} transfer.`);
        }

        // Security check for godown staff
        const isStaff = req.user && req.user.godownId;
        if (isStaff && transfer.fromGodownId !== req.user.godownId && transfer.toGodownId !== req.user.godownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.FORBIDDEN, 'Access denied.');
        }

        // If transitioning to Received, we execute the stock mutations!
        if (status === 'Received') {
            const fromGodown = await Godown.findByPk(transfer.fromGodownId, { transaction: t });
            const toGodown = await Godown.findByPk(transfer.toGodownId, { transaction: t });

            const fromGodownName = fromGodown?.name || 'Source Godown';
            const toGodownName = toGodown?.name || 'Destination Godown';

            for (const item of transfer.items) {
                // Fetch variant to get the baseUnitsPerPack factor
                const variant = await ProductVariant.findByPk(item.variantId, { transaction: t });
                const factor = Number(variant?.baseUnitsPerPack || 1);
                const qtyInBaseUnits = Number(item.qty) * factor;

                // 1. Decrement source stock
                const totalSourceStockUnits = parseFloat(await InventoryStock.sum('totalBaseUnits', {
                    where: { productId: item.productId, variantId: item.variantId, godownId: transfer.fromGodownId },
                    transaction: t
                })) || 0;

                if (totalSourceStockUnits < qtyInBaseUnits) {
                    await t.rollback();
                    return sendErrorResponse(
                        res,
                        HTTP_STATUS.BAD_REQUEST,
                        `Insufficient stock in source godown to complete receipt for product ID ${item.productId}.`
                    );
                }

                let sourceStock = await InventoryStock.findOne({
                    where: { productId: item.productId, variantId: item.variantId, godownId: transfer.fromGodownId },
                    order: [['totalBaseUnits', 'DESC']],
                    transaction: t
                });

                const newSourceQty = Number(sourceStock.totalBaseUnits) - qtyInBaseUnits;
                await sourceStock.update({ totalBaseUnits: newSourceQty }, { transaction: t });

                // Log InventoryTransaction for Outgoing
                await InventoryTransaction.create({
                    stockId: sourceStock.id,
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId: transfer.fromGodownId,
                    type: 'ADJUSTMENT',
                    primaryUnitId: sourceStock.primaryUnitId,
                    secondaryUnitId: sourceStock.secondaryUnitId,
                    secondaryPerPrimary: sourceStock.secondaryPerPrimary,
                    qtyPrimary: 0,
                    qtySecondary: 0,
                    totalQtyBaseUnits: -qtyInBaseUnits,
                    avgPriceAfterTxn: sourceStock.avgPurchasePricePerBaseUnit || 0,
                    balanceAfterBaseUnits: newSourceQty,
                    note: `Stock Transfer Out to ${toGodownName} (TRF: ${transfer.transferNo})`,
                    createdBy: req.user?.name || req.user?.fullname || 'System'
                }, { transaction: t });

                // 2. Increment destination stock
                let destStock = await InventoryStock.findOne({
                    where: { productId: item.productId, variantId: item.variantId, godownId: transfer.toGodownId },
                    transaction: t
                });

                if (!destStock) {
                    destStock = await InventoryStock.create({
                        productId: item.productId,
                        variantId: item.variantId,
                        godownId: transfer.toGodownId,
                        primaryUnitId: sourceStock.primaryUnitId,
                        secondaryUnitId: sourceStock.secondaryUnitId,
                        secondaryPerPrimary: sourceStock.secondaryPerPrimary,
                        totalBaseUnits: 0,
                        avgPurchasePricePerBaseUnit: sourceStock.avgPurchasePricePerBaseUnit || 0,
                        status: 'Active'
                    }, { transaction: t });
                }

                const newDestQty = Number(destStock.totalBaseUnits) + qtyInBaseUnits;
                await destStock.update({ totalBaseUnits: newDestQty }, { transaction: t });

                // Sync level pricing from source godown (or global) to destination godown
                try {
                    const sourcePricings = await ProductPricing.findAll({
                        where: {
                            variantId: item.variantId,
                            [Op.or]: [
                                { godownId: transfer.fromGodownId },
                                { godownId: null }
                            ]
                        },
                        transaction: t
                    });

                    if (sourcePricings && sourcePricings.length > 0) {
                        const pricingMap = new Map();
                        for (const p of sourcePricings) {
                            if (!pricingMap.has(p.customLevelId) || p.godownId) {
                                pricingMap.set(p.customLevelId, p);
                            }
                        }

                        await ProductPricing.destroy({
                            where: { variantId: item.variantId, godownId: transfer.toGodownId },
                            transaction: t
                        });

                        for (const p of pricingMap.values()) {
                            await ProductPricing.create({
                                variantId: item.variantId,
                                godownId: transfer.toGodownId,
                                customLevelId: p.customLevelId,
                                quantityRange: p.quantityRange,
                                minQty: p.minQty,
                                maxQty: p.maxQty,
                                purchasePrice: p.purchasePrice,
                                price: p.price,
                                mrp: p.mrp,
                                status: 'Active'
                            }, { transaction: t });
                        }
                    }
                } catch (pErr) {
                    console.error("Error syncing destination godown pricing during transfer:", pErr);
                }

                // Log InventoryTransaction for Incoming
                await InventoryTransaction.create({
                    stockId: destStock.id,
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId: transfer.toGodownId,
                    type: 'ADJUSTMENT',
                    primaryUnitId: destStock.primaryUnitId,
                    secondaryUnitId: destStock.secondaryUnitId,
                    secondaryPerPrimary: destStock.secondaryPerPrimary,
                    qtyPrimary: 0,
                    qtySecondary: 0,
                    totalQtyBaseUnits: qtyInBaseUnits,
                    avgPriceAfterTxn: destStock.avgPurchasePricePerBaseUnit || 0,
                    balanceAfterBaseUnits: newDestQty,
                    note: `Stock Transfer In from ${fromGodownName} (TRF: ${transfer.transferNo})`,
                    createdBy: req.user?.name || req.user?.fullname || 'System'
                }, { transaction: t });
            }
        }

        // Update transfer status
        await transfer.update({ status }, { transaction: t });

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, `Stock transfer marked as ${status} successfully.`, transfer);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const getActiveGodowns = async (req, res, next) => {
    try {
        const godowns = await Godown.findAll({
            where: { status: 'Active' },
            attributes: ['id', 'name'],
            order: [['name', 'ASC']]
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Godowns retrieved successfully.', godowns);
    } catch (error) {
        next(error);
    }
};

export const getGodownStock = async (req, res, next) => {
    try {
        const { godownId } = req.params;

        const variants = await ProductVariant.findAll({
            where: { status: { [Op.ne]: 'Deleted' } },
            include: [
                { model: Product, as: 'product', where: { status: { [Op.ne]: 'Deleted' } }, attributes: ['id', 'name'] },
                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
            ]
        });

        const stocks = await InventoryStock.findAll({
            where: { godownId },
            attributes: ['productId', 'variantId', 'totalBaseUnits', 'lastPurchasePricePerBaseUnit', 'avgPurchasePricePerBaseUnit']
        });

        const stockMap = {};
        stocks.forEach(s => {
            const key = `${s.productId}_${s.variantId}`;
            stockMap[key] = {
                totalBaseUnits: s.totalBaseUnits || 0,
                lastPurchasePricePerBaseUnit: parseFloat(s.lastPurchasePricePerBaseUnit) || 0,
                avgPurchasePricePerBaseUnit: parseFloat(s.avgPurchasePricePerBaseUnit) || 0
            };
        });

        const options = [];
        variants.forEach(v => {
            if (!v.product) return;
            const key = `${v.productId}_${v.id}`;
            const sData = stockMap[key] || { totalBaseUnits: 0, lastPurchasePricePerBaseUnit: 0, avgPurchasePricePerBaseUnit: 0 };
            const qtyAvailableBase = sData.totalBaseUnits;
            const factor = Number(v.baseUnitsPerPack || 1);
            const qtyAvailable = qtyAvailableBase / factor;
            
            const nameEn = v.product.name?.en || '';
            const nameGu = v.product.name?.gu || v.product.name?.guj || '';
            const prodName = nameGu ? `${nameEn} (${nameGu})` : nameEn;

            const volObj = v.volumeRef?.name || v.volume || 'N/A';
            const volEn = typeof volObj === 'object' && volObj !== null ? (volObj.en || volObj.EN || '') : String(volObj);
            const volGu = typeof volObj === 'object' && volObj !== null ? (volObj.gu || volObj.GU || '') : '';
            const volLabel = volGu ? `${volEn} (${volGu})` : volEn;

            // Prioritize last purchase price from godown stock if available
            let itemPurchasePrice = Number(v.purchasePrice || 0);
            if (sData.lastPurchasePricePerBaseUnit > 0) {
                itemPurchasePrice = Math.round(sData.lastPurchasePricePerBaseUnit * factor * 100) / 100;
            } else if (sData.avgPurchasePricePerBaseUnit > 0) {
                itemPurchasePrice = Math.round(sData.avgPurchasePricePerBaseUnit * factor * 100) / 100;
            }

            // Clean up floating point precision artifacts (e.g., 1999.92 -> 2000.00)
            if (Math.abs(Math.round(itemPurchasePrice) - itemPurchasePrice) < 0.1) {
                itemPurchasePrice = Math.round(itemPurchasePrice);
            }

            options.push({
                productId: v.productId,
                variantId: v.id,
                productName: prodName,
                productNameGu: nameGu || nameEn,
                volume: volLabel,
                volumeGu: volGu || volEn,
                qtyAvailable,
                price: itemPurchasePrice
            });
        });

        options.sort((a, b) => a.productName.localeCompare(b.productName));

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Godown stock retrieved successfully.', options);
    } catch (error) {
        next(error);
    }
};
