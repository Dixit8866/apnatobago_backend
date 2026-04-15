import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../../models/superadmin-models/ProductPricing.js';
import InventoryStock from '../../models/superadmin-models/InventoryStock.js';
import InventoryTransaction from '../../models/superadmin-models/InventoryTransaction.js';
import Godown from '../../models/superadmin-models/Godown.js';
import Volume from '../../models/superadmin-models/Volume.js';
import SellingVolume from '../../models/superadmin-models/SellingVolume.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';

function normalizeInt(val) {
    const num = Number(val);
    if (!Number.isInteger(num) || num < 0) return null;
    return num;
}

function qtyToBaseUnits(primaryQty, secondaryQty, secondaryPerPrimary) {
    const p = normalizeInt(primaryQty);
    const s = normalizeInt(secondaryQty);
    const factor = normalizeInt(secondaryPerPrimary);
    if (p == null || s == null || factor == null || factor <= 0) return null;
    return p * factor + s;
}

function splitBaseUnits(totalBaseUnits, secondaryPerPrimary) {
    const total = Number(totalBaseUnits || 0);
    const factor = Number(secondaryPerPrimary || 1);
    return {
        qtyPrimary: Math.floor(total / factor),
        qtySecondary: total % factor,
    };
}

function round2(n) {
    return Number(Number(n).toFixed(2));
}

async function validateProductVariant(productId, variantId, transaction) {
    const variant = await ProductVariant.findOne({
        where: { id: variantId, productId, status: { [Op.ne]: 'Deleted' } },
        transaction,
    });
    if (!variant) return null;
    const product = await Product.findOne({
        where: { id: productId, status: { [Op.ne]: 'Deleted' } },
        transaction,
    });
    if (!product) return null;
    return { product, variant };
}

async function validateGodown(godownId, transaction) {
    const godown = await Godown.findOne({
        where: { id: godownId, status: 'Active' },
        transaction,
    });
    return godown || null;
}

async function validateVolumeIds({ primaryUnitId, secondaryUnitId, transaction }) {
    const ids = [primaryUnitId, secondaryUnitId].filter(Boolean);
    if (!ids.length) return false;
    
    // Check both normal volumes and selling volumes
    const [volRows, sellRows] = await Promise.all([
        Volume.findAll({ where: { id: { [Op.in]: ids }, status: 'Active' }, transaction }),
        SellingVolume.findAll({ where: { id: { [Op.in]: ids }, status: 'Active' }, transaction })
    ]);
    
    // Total found unique IDs should match the requested ids count
    const foundIds = new Set([...volRows.map(r => r.id), ...sellRows.map(r => r.id)]);
    return foundIds.size === ids.length;
}

export const getInventoryOptions = async (req, res, next) => {
    try {
        const [products, godowns, volumes, sellingVolumes] = await Promise.all([
            Product.findAll({
                where: { status: { [Op.ne]: 'Deleted' } },
                order: [['createdAt', 'DESC']],
                include: [
                    {
                        model: ProductVariant,
                        as: 'variants',
                        where: { status: { [Op.ne]: 'Deleted' } },
                        required: false,
                        include: [
                            {
                                model: ProductPricing,
                                as: 'pricings',
                                where: { status: { [Op.ne]: 'Deleted' } },
                                required: false,
                                order: [['minQty', 'ASC']],
                            },
                        ],
                    },
                ],
            }),
            Godown.findAll({
                where: { status: 'Active' },
                order: [['createdAt', 'DESC']],
            }),
            Volume.findAll({
                where: { status: 'Active' },
                order: [['createdAt', 'DESC']],
            }),
            SellingVolume.findAll({
                where: { status: 'Active' },
                order: [['createdAt', 'DESC']],
            }),
        ]);

        const normalizedProducts = products.map((product) => {
            const p = product.toJSON();
            // packagings is already stored as JSONB array on product:
            // e.g. [{ baseUnitLabel: 'Dando', baseUnitsPerPack: 20, containsUnit: 'Box', relativeQty: 20 }]
            p.packagings = Array.isArray(p.packagings) ? p.packagings : [];

            p.variants = (p.variants || []).map((variant) => {
                const firstPricing = [...(variant.pricings || [])].sort((a, b) => Number(a.minQty || 0) - Number(b.minQty || 0))[0];
                return {
                    ...variant,
                    defaultSellingPrice: firstPricing ? Number(firstPricing.price || 0) : 0,
                    defaultPurchasePrice: Number(variant.purchasePrice || 0),
                    defaultMrp: firstPricing ? Number(firstPricing.mrp || 0) : 0,
                };
            });
            return p;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory options fetched successfully.', {
            products: normalizedProducts,
            godowns,
            volumes,
            sellingVolumes,
        });
    } catch (error) {
        next(error);
    }
};

export const getInventoryStocks = async (req, res, next) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;
        const { search = '' } = req.query;

        const include = [
            { model: Product, as: 'product', attributes: ['id', 'name', 'status'] },
            { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'status'] },
            { model: Godown, as: 'godown', attributes: ['id', 'name', 'status'] },
        ];

        const where = {};
        if (search) {
            include[0].where = { name: { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } };
            include[0].required = true;
        }

        const result = await InventoryStock.findAndCountAll({
            where,
            include,
            limit,
            offset,
            order: [['updatedAt', 'DESC']],
        });

        const stockRows = result.rows || [];
        const stockIds = stockRows.map((row) => row.id);
        const unitIds = [
            ...new Set(
                stockRows
                    .flatMap((row) => [row.primaryUnitId, row.secondaryUnitId])
                    .filter(Boolean)
            ),
        ];

        const [unitRowsVol, unitRowsSell, purchaseTxns] = await Promise.all([
            unitIds.length
                ? Volume.findAll({
                    where: { id: { [Op.in]: unitIds } },
                    attributes: ['id', 'name'],
                })
                : [],
            unitIds.length
                ? SellingVolume.findAll({
                    where: { id: { [Op.in]: unitIds } },
                    attributes: ['id', 'name'],
                })
                : [],
            stockIds.length
                ? InventoryTransaction.findAll({
                    where: { stockId: { [Op.in]: stockIds }, type: 'PURCHASE' },
                    attributes: ['stockId', 'purchasePricePerBaseUnit', 'createdAt'],
                    order: [['createdAt', 'DESC']],
                })
                : [],
        ]);

        const getUnitLabel = (volume) => {
            if (!volume?.name || typeof volume.name !== 'object') return typeof volume?.name === 'string' ? volume.name : 'Unit';
            return volume.name.en || Object.values(volume.name)[0] || 'Unit';
        };
        const unitRows = [...unitRowsVol, ...unitRowsSell];
        const unitMap = new Map(unitRows.map((u) => [u.id, getUnitLabel(u)]));
        const latestPurchasePriceMap = new Map();
        for (const txn of purchaseTxns) {
            if (!latestPurchasePriceMap.has(txn.stockId)) {
                latestPurchasePriceMap.set(txn.stockId, Number(txn.purchasePricePerBaseUnit || 0));
            }
        }

        const responseData = formatPaginatedResponse(result, page, limit);
        const enriched = responseData.data.map((row) => {
            const split = splitBaseUnits(row.totalBaseUnits, row.secondaryPerPrimary);
            const primaryUnitName = unitMap.get(row.primaryUnitId) || 'Unit';
            const secondaryUnitName = row.secondaryUnitId ? (unitMap.get(row.secondaryUnitId) || 'Unit') : null;
            const conversionLabel = secondaryUnitName
                ? `1 ${primaryUnitName} = ${row.secondaryPerPrimary} ${secondaryUnitName}`
                : `1 ${primaryUnitName}`;
            return {
                ...row.toJSON(),
                qtyPrimary: split.qtyPrimary,
                qtySecondary: split.qtySecondary,
                primaryUnitName,
                secondaryUnitName,
                conversionLabel,
                lastPurchasePricePerBaseUnit: latestPurchasePriceMap.get(row.id) ?? Number(row.avgPurchasePricePerBaseUnit || 0),
                effectiveStockLabel: secondaryUnitName
                    ? `${split.qtyPrimary} ${primaryUnitName} + ${split.qtySecondary} ${secondaryUnitName}`
                    : `${split.qtyPrimary} ${primaryUnitName}`,
                stockValue: round2(Number(row.avgPurchasePricePerBaseUnit || 0) * Number(row.totalBaseUnits || 0)),
            };
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory stocks fetched successfully.', {
            ...responseData,
            data: enriched,
        });
    } catch (error) {
        next(error);
    }
};

export const getInventoryStockById = async (req, res, next) => {
    try {
        const stock = await InventoryStock.findByPk(req.params.id, {
            include: [
                { model: Product, as: 'product', attributes: ['id', 'name', 'status'] },
                { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'status'] },
                { model: Godown, as: 'godown', attributes: ['id', 'name', 'status'] },
            ],
        });

        if (!stock) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Inventory stock not found.');
        }

        const unitIds = [stock.primaryUnitId, stock.secondaryUnitId].filter(Boolean);
        const unitRows = unitIds.length
            ? await Volume.findAll({ where: { id: { [Op.in]: unitIds } }, attributes: ['id', 'name'] })
            : [];
        const unitMap = new Map(
            unitRows.map((u) => [u.id, u.name?.en || Object.values(u.name || {})[0] || 'Unit'])
        );
        const split = splitBaseUnits(stock.totalBaseUnits, stock.secondaryPerPrimary);
        const primaryUnitName = unitMap.get(stock.primaryUnitId) || 'Unit';
        const secondaryUnitName = stock.secondaryUnitId ? (unitMap.get(stock.secondaryUnitId) || 'Unit') : null;

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory stock fetched successfully.', {
            ...stock.toJSON(),
            qtyPrimary: split.qtyPrimary,
            qtySecondary: split.qtySecondary,
            primaryUnitName,
            secondaryUnitName,
            conversionLabel: secondaryUnitName
                ? `1 ${primaryUnitName} = ${stock.secondaryPerPrimary} ${secondaryUnitName}`
                : `1 ${primaryUnitName}`,
        });
    } catch (error) {
        next(error);
    }
};

export const getInventorySummary = async (req, res, next) => {
    try {
        const stocks = await InventoryStock.findAll({
            where: { status: { [Op.ne]: 'Deleted' } },
            include: [
                { model: Product, as: 'product', attributes: ['id', 'name'] },
                { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] },
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
            ],
            order: [['updatedAt', 'DESC']],
        });

        const totals = {
            totalSkus: stocks.length,
            totalBaseUnits: 0,
            totalStockValue: 0,
            lowStockCount: 0,
        };
        const productVolumeSummaryMap = new Map();
        const godownSummaryMap = new Map();

        for (const stock of stocks) {
            const baseUnits = Number(stock.totalBaseUnits || 0);
            const avg = Number(stock.avgPurchasePricePerBaseUnit || 0);
            const stockValue = round2(baseUnits * avg);
            totals.totalBaseUnits += baseUnits;
            totals.totalStockValue += stockValue;
            if (baseUnits <= 10) totals.lowStockCount += 1;

            const productName = stock.product?.name?.en || Object.values(stock.product?.name || {})[0] || 'Unnamed';
            const volume = stock.variant?.volume || '-';
            const pvKey = `${stock.productId}__${stock.variantId}`;
            if (!productVolumeSummaryMap.has(pvKey)) {
                productVolumeSummaryMap.set(pvKey, {
                    productId: stock.productId,
                    variantId: stock.variantId,
                    productName,
                    volume,
                    totalBaseUnits: 0,
                    totalStockValue: 0,
                });
            }
            const pv = productVolumeSummaryMap.get(pvKey);
            pv.totalBaseUnits += baseUnits;
            pv.totalStockValue = round2(Number(pv.totalStockValue || 0) + stockValue);

            const gKey = stock.godownId;
            if (!godownSummaryMap.has(gKey)) {
                godownSummaryMap.set(gKey, {
                    godownId: stock.godownId,
                    godownName: stock.godown?.name || 'Unknown',
                    totalBaseUnits: 0,
                    totalStockValue: 0,
                    skuCount: 0,
                });
            }
            const g = godownSummaryMap.get(gKey);
            g.totalBaseUnits += baseUnits;
            g.totalStockValue = round2(Number(g.totalStockValue || 0) + stockValue);
            g.skuCount += 1;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory summary fetched successfully.', {
            totals: {
                ...totals,
                totalStockValue: round2(totals.totalStockValue),
            },
            productVolumes: Array.from(productVolumeSummaryMap.values()).sort(
                (a, b) => Number(b.totalStockValue || 0) - Number(a.totalStockValue || 0)
            ),
            godowns: Array.from(godownSummaryMap.values()).sort(
                (a, b) => Number(b.totalStockValue || 0) - Number(a.totalStockValue || 0)
            ),
        });
    } catch (error) {
        next(error);
    }
};

export const getInventoryTransactions = async (req, res, next) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await InventoryTransaction.findAndCountAll({
            include: [
                { model: Product, as: 'product', attributes: ['id', 'name'] },
                { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] },
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory transactions fetched successfully.', responseData);
    } catch (error) {
        next(error);
    }
};

export const createPurchaseTransaction = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const {
            productId,
            variantId,
            godownId,
            primaryUnitId,
            secondaryUnitId = null,
            secondaryPerPrimary = 1,
            qtyPrimary = 0,
            qtySecondary = 0,
            purchasePricePerBaseUnit,
            note,
        } = req.body;
        const qtyTotalBaseUnits = qtyToBaseUnits(qtyPrimary, qtySecondary, secondaryPerPrimary);
        const unitPrice = Number(purchasePricePerBaseUnit);

        if (!productId || !variantId || !godownId || !primaryUnitId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId, variantId, godownId and primaryUnitId are required.');
        }
        if (qtyTotalBaseUnits == null || qtyTotalBaseUnits <= 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Purchase quantity must be greater than zero.');
        }
        if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'purchasePricePerBaseUnit must be greater than zero.');
        }

        const valid = await validateProductVariant(productId, variantId, t);
        if (!valid) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid product/variant selection.');
        }
        const validGodown = await validateGodown(godownId, t);
        if (!validGodown) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid godown selection.');
        }
        const validUnits = await validateVolumeIds({ primaryUnitId, secondaryUnitId, transaction: t });
        if (!validUnits) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid unit selection.');
        }

        let stock = await InventoryStock.findOne({ where: { productId, variantId, godownId }, transaction: t });
        if (!stock) {
            stock = await InventoryStock.create(
                {
                    productId,
                    variantId,
                    godownId,
                    primaryUnitId,
                    secondaryUnitId,
                    secondaryPerPrimary: Number(secondaryPerPrimary || 1),
                    totalBaseUnits: 0,
                    avgPurchasePricePerBaseUnit: 0,
                    status: 'Active',
                },
                { transaction: t }
            );
        }

        const oldQty = Number(stock.totalBaseUnits || 0);
        const oldAvg = Number(stock.avgPurchasePricePerBaseUnit || 0);
        const newQty = oldQty + qtyTotalBaseUnits;
        const newAvg = round2(((oldQty * oldAvg) + (qtyTotalBaseUnits * unitPrice)) / newQty);

        await stock.update(
            {
                primaryUnitId,
                secondaryUnitId,
                secondaryPerPrimary: Number(secondaryPerPrimary || stock.secondaryPerPrimary || 1),
                totalBaseUnits: newQty,
                avgPurchasePricePerBaseUnit: newAvg,
            },
            { transaction: t }
        );

        const transaction = await InventoryTransaction.create(
            {
                stockId: stock.id,
                productId,
                variantId,
                godownId,
                type: 'PURCHASE',
                primaryUnitId,
                secondaryUnitId,
                secondaryPerPrimary: Number(secondaryPerPrimary || 1),
                qtyPrimary: Number(qtyPrimary || 0),
                qtySecondary: Number(qtySecondary || 0),
                totalQtyBaseUnits: qtyTotalBaseUnits,
                purchasePricePerBaseUnit: unitPrice,
                avgPriceAfterTxn: newAvg,
                balanceAfterBaseUnits: newQty,
                note: note || null,
            },
            { transaction: t }
        );

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Purchase transaction saved successfully.', transaction);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const createSaleTransaction = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const {
            productId,
            variantId,
            godownId,
            primaryUnitId,
            secondaryUnitId = null,
            secondaryPerPrimary = 1,
            qtyPrimary = 0,
            qtySecondary = 0,
            note,
        } = req.body;
        const qtyTotalBaseUnits = qtyToBaseUnits(qtyPrimary, qtySecondary, secondaryPerPrimary);

        if (!productId || !variantId || !godownId || !primaryUnitId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId, variantId, godownId and primaryUnitId are required.');
        }
        if (qtyTotalBaseUnits == null || qtyTotalBaseUnits <= 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Sale quantity must be greater than zero.');
        }

        const validGodown = await validateGodown(godownId, t);
        if (!validGodown) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid godown selection.');
        }
        const stock = await InventoryStock.findOne({ where: { productId, variantId, godownId }, transaction: t });
        if (!stock) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Stock not found for selected product variant.');
        }

        const currentQty = Number(stock.totalBaseUnits || 0);
        if (qtyTotalBaseUnits > currentQty) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Insufficient stock for sale.');
        }

        const newQty = currentQty - qtyTotalBaseUnits;
        const avgPrice = Number(stock.avgPurchasePricePerBaseUnit || 0);
        const nextAvg = newQty === 0 ? 0 : avgPrice;

        await stock.update(
            {
                totalBaseUnits: newQty,
                avgPurchasePricePerBaseUnit: nextAvg,
            },
            { transaction: t }
        );

        const transaction = await InventoryTransaction.create(
            {
                stockId: stock.id,
                productId,
                variantId,
                godownId,
                type: 'SALE',
                primaryUnitId,
                secondaryUnitId,
                secondaryPerPrimary: Number(secondaryPerPrimary || stock.secondaryPerPrimary || 1),
                qtyPrimary: Number(qtyPrimary || 0),
                qtySecondary: Number(qtySecondary || 0),
                totalQtyBaseUnits: qtyTotalBaseUnits,
                purchasePricePerBaseUnit: null,
                avgPriceAfterTxn: nextAvg,
                balanceAfterBaseUnits: newQty,
                note: note || null,
            },
            { transaction: t }
        );

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Sale transaction saved successfully.', transaction);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const updateInventoryStock = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const stock = await InventoryStock.findByPk(req.params.id, { transaction: t });
        if (!stock) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Inventory stock not found.');
        }

        const {
            productId = stock.productId,
            variantId = stock.variantId,
            godownId = stock.godownId,
            primaryUnitId = stock.primaryUnitId,
            secondaryUnitId = stock.secondaryUnitId,
            secondaryPerPrimary = stock.secondaryPerPrimary,
            qtyPrimary = 0,
            qtySecondary = 0,
            purchasePricePerBaseUnit,
            note,
        } = req.body;

        const qtyTotalBaseUnits = qtyToBaseUnits(qtyPrimary, qtySecondary, secondaryPerPrimary);
        const avgPrice = Number(purchasePricePerBaseUnit);

        if (!productId || !variantId || !godownId || !primaryUnitId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId, variantId, godownId and primaryUnitId are required.');
        }
        if (qtyTotalBaseUnits == null || qtyTotalBaseUnits < 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Stock quantity must be zero or greater.');
        }
        if (!Number.isFinite(avgPrice) || avgPrice < 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'purchasePricePerBaseUnit must be zero or greater.');
        }

        const valid = await validateProductVariant(productId, variantId, t);
        if (!valid) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid product/variant selection.');
        }
        const validGodown = await validateGodown(godownId, t);
        if (!validGodown) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid godown selection.');
        }
        const validUnits = await validateVolumeIds({ primaryUnitId, secondaryUnitId, transaction: t });
        if (!validUnits) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid unit selection.');
        }

        const existing = await InventoryStock.findOne({
            where: {
                productId,
                variantId,
                godownId,
                id: { [Op.ne]: stock.id },
            },
            transaction: t,
        });
        if (existing) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Stock already exists for selected product, variant and godown.');
        }

        const previousBaseUnits = Number(stock.totalBaseUnits || 0);
        const deltaBaseUnits = qtyTotalBaseUnits - previousBaseUnits;
        const deltaAbsSplit = splitBaseUnits(Math.abs(deltaBaseUnits), secondaryPerPrimary);

        await stock.update(
            {
                productId,
                variantId,
                godownId,
                primaryUnitId,
                secondaryUnitId: secondaryUnitId || null,
                secondaryPerPrimary: Number(secondaryPerPrimary || 1),
                totalBaseUnits: qtyTotalBaseUnits,
                avgPurchasePricePerBaseUnit: round2(avgPrice),
            },
            { transaction: t }
        );

        await InventoryTransaction.create(
            {
                stockId: stock.id,
                productId,
                variantId,
                godownId,
                type: 'ADJUSTMENT',
                primaryUnitId,
                secondaryUnitId: secondaryUnitId || null,
                secondaryPerPrimary: Number(secondaryPerPrimary || 1),
                qtyPrimary: deltaAbsSplit.qtyPrimary,
                qtySecondary: deltaAbsSplit.qtySecondary,
                totalQtyBaseUnits: deltaBaseUnits,
                purchasePricePerBaseUnit: round2(avgPrice),
                avgPriceAfterTxn: round2(avgPrice),
                balanceAfterBaseUnits: qtyTotalBaseUnits,
                note: note || 'Manual stock edit',
            },
            { transaction: t }
        );

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory stock updated successfully.', stock);
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const deleteInventoryStock = async (req, res, next) => {
    try {
        const stock = await InventoryStock.findByPk(req.params.id);
        if (!stock) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Inventory stock not found.');
        }

        await stock.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory stock deleted successfully.');
    } catch (error) {
        next(error);
    }
};
