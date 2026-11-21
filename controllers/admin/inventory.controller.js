import { Op, QueryTypes } from 'sequelize';
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
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

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
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return false;
    const rows = await Volume.findAll({
        where: { id: { [Op.in]: uniqueIds }, status: 'Active' },
        transaction,
    });
    return rows.length === uniqueIds.length;
}

export const getInventoryOptions = async (req, res, next) => {
    try {
        const [products, godowns, volumes] = await Promise.all([
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
                            {
                                model: InventoryStock,
                                as: 'inventoryStocks',
                                where: { status: 'Active' },
                                required: false,
                            },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
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
        ]);
        const normalizedProducts = products.map((product) => {
            const p = product.toJSON();
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
        });
    } catch (error) {
        next(error);
    }
};

export const getInventoryStocks = async (req, res, next) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;
        const { search = '', productId, godownId, variantId } = req.query;

        const trimmedSearch = String(search).trim();

        const include = [
            { model: Product, as: 'product', attributes: ['id', 'name', 'status'] },
            { 
                model: ProductVariant, 
                as: 'variant', 
                attributes: ['id', 'volume', 'extra', 'volumeId', 'status'],
                include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'], required: false }]
            },
            { model: Godown, as: 'godown', attributes: ['id', 'name', 'status'] },
        ];

        const where = {};
        if (productId) {
            where.productId = productId;
        }
        if (godownId) {
            where.godownId = godownId;
        }
        if (variantId) {
            where.variantId = variantId;
        }
        if (trimmedSearch) {
            include[0].where = sequelize.where(
                sequelize.cast(sequelize.col('product.name'), 'text'),
                { [Op.iLike]: `%${trimmedSearch}%` }
            );
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

        const unitRows = unitIds.length
            ? await Volume.findAll({
                where: { id: { [Op.in]: unitIds } },
                attributes: ['id', 'name'],
            })
            : [];

        const getUnitLabel = (volume) => {
            if (!volume?.name || typeof volume.name !== 'object') return 'Unit';
            return volume.name.en || Object.values(volume.name)[0] || 'Unit';
        };
        const unitMap = new Map(unitRows.map((u) => [u.id, getUnitLabel(u)]));

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
                lastPurchasePricePerBaseUnit: Number(row.lastPurchasePricePerBaseUnit || row.avgPurchasePricePerBaseUnit || 0),
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
                { 
                    model: ProductVariant, 
                    as: 'variant', 
                    attributes: ['id', 'volume', 'extra', 'volumeId', 'status'],
                    include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'], required: false }]
                },
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

const getCreatorName = (req) => {
    if (!req || !req.user) return 'System';
    return req.user.fullname || req.user.name || req.user.username || req.user.number || 'System Admin';
};

export const getInventoryTransactions = async (req, res, next) => {
    try {
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;
        const { search, type, godownId } = req.query;

        const where = {};
        if (type && type !== 'all' && type !== 'ALL') {
            where.type = type.toUpperCase();
        }
        if (godownId && godownId !== 'all') {
            where.godownId = godownId;
        }

        const andConditions = [];

        if (search && String(search).trim() !== '') {
            const term = String(search).trim();
            const searchPattern = `%${term}%`;
            const escapedSearch = sequelize.escape(searchPattern);

            andConditions.push(
                sequelize.literal(`(
                    COALESCE("InventoryTransaction"."createdBy", '') ILIKE ${escapedSearch}
                    OR COALESCE("InventoryTransaction"."note", '') ILIKE ${escapedSearch}
                    OR COALESCE(CAST("InventoryTransaction"."type" AS TEXT), '') ILIKE ${escapedSearch}
                    OR COALESCE("product"."name"->>'en', '') ILIKE ${escapedSearch}
                    OR COALESCE("product"."name"->>'gu', '') ILIKE ${escapedSearch}
                    OR COALESCE("godown"."name", '') ILIKE ${escapedSearch}
                )`)
            );
        }

        if (andConditions.length > 0) {
            where[Op.and] = andConditions;
        }

        const result = await InventoryTransaction.findAndCountAll({
            where,
            include: [
                { model: Product, as: 'product', attributes: ['id', 'name'] },
                {
                    model: ProductVariant,
                    as: 'variant',
                    attributes: ['id', 'volume', 'extra', 'volumeId'],
                    include: [
                        { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                    ]
                },
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
        });

        const transactionRows = result.rows || [];
        const unitIds = [
            ...new Set(
                transactionRows
                    .flatMap((row) => [row.primaryUnitId, row.secondaryUnitId])
                    .filter(Boolean)
            ),
        ];

        const unitRows = unitIds.length
            ? await Volume.findAll({
                where: { id: { [Op.in]: unitIds } },
                attributes: ['id', 'name'],
            })
            : [];

        const getUnitLabel = (volume) => {
            if (!volume?.name || typeof volume.name !== 'object') return 'Unit';
            return volume.name.gu || volume.name.en || Object.values(volume.name)[0] || 'Unit';
        };
        const unitMap = new Map(unitRows.map((u) => [u.id, getUnitLabel(u)]));

        const responseData = formatPaginatedResponse(result, page, limit);
        const enriched = responseData.data.map((row) => {
            const primaryUnitName = unitMap.get(row.primaryUnitId) || 'Unit';
            const secondaryUnitName = row.secondaryUnitId ? (unitMap.get(row.secondaryUnitId) || 'Unit') : null;
            return {
                ...row.toJSON(),
                primaryUnitName,
                secondaryUnitName,
            };
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory transactions fetched successfully.', {
            ...responseData,
            data: enriched,
        });
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
                lastPurchasePricePerBaseUnit: unitPrice,
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
                createdBy: getCreatorName(req),
            },
            { transaction: t }
        );

        await t.commit();

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Added Stock Purchase of ${qtyTotalBaseUnits} base units for product ID #${productId}`,
            metadata: { productId, variantId, godownId, qtyTotalBaseUnits }
        });

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
            secondaryUnitId,
            secondaryPerPrimary,
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

        const stock = await InventoryStock.findOne({
            where: { productId, variantId, godownId },
            transaction: t,
        });

        if (!stock || stock.totalBaseUnits < qtyTotalBaseUnits) {
            await t.rollback();
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                `Insufficient stock to complete sale transaction. Available: ${stock ? stock.totalBaseUnits : 0} base units.`
            );
        }

        const newQty = stock.totalBaseUnits - qtyTotalBaseUnits;
        const nextAvg = Number(stock.avgPurchasePricePerBaseUnit || 0);

        await stock.update(
            {
                totalBaseUnits: newQty,
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
                secondaryUnitId: secondaryUnitId || null,
                secondaryPerPrimary: Number(secondaryPerPrimary || 1),
                qtyPrimary: Number(qtyPrimary || 0),
                qtySecondary: Number(qtySecondary || 0),
                totalQtyBaseUnits: qtyTotalBaseUnits,
                purchasePricePerBaseUnit: null,
                avgPriceAfterTxn: nextAvg,
                balanceAfterBaseUnits: newQty,
                note: note || null,
                createdBy: getCreatorName(req),
            },
            { transaction: t }
        );

        await t.commit();

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Recorded Manual Stock Sale of ${qtyTotalBaseUnits} base units for product ID #${productId}`,
            metadata: { productId, variantId, godownId, qtyTotalBaseUnits }
        });

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

        if (productId !== stock.productId || variantId !== stock.variantId || godownId !== stock.godownId) {
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
                lastPurchasePricePerBaseUnit: round2(avgPrice),
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
                createdBy: getCreatorName(req),
            },
            { transaction: t }
        );

        await t.commit();

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Adjusted Stock Inventory for product ID #${stock.productId} to ${qtyTotalBaseUnits} base units`,
            metadata: { stockId: stock.id, productId, godownId, qtyTotalBaseUnits }
        });

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

        const stockId = stock.id;
        const prodId = stock.productId;
        await stock.destroy();

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'DELETE',
            description: `Deleted Stock Inventory entry #${stockId} for product ID #${prodId}`,
            metadata: { stockId, productId: prodId }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory stock deleted successfully.');
    } catch (error) {
        next(error);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Volume Wise Stock (Inventory Overview page)
//
// One row per product volume (variant):  Opening + Purchase − Sales = Available
//  - Available = live stock (inventory_stocks), the same stock that orders use.
//  - Purchase  = PURCHASE entries of the inventory log.
//  - Sales     = SALE entries minus stock that came back (good sales returns,
//                cancelled / edited / deleted order restores).
//  - Opening   = Available − Purchase + Sales, so the formula always matches live
//                stock. Editing Opening adds/removes stock as an ADJUSTMENT.
// Quantities are shown in the volume's own unit (stock is stored in base units),
// and the rate is the volume's purchase rate from product details.
// ─────────────────────────────────────────────────────────────────────────────

const round3 = (n) => Number(Number(n || 0).toFixed(3));

const getVolumeLabel = (variant) => {
    const ref = variant?.volumeRef?.name;
    const en = ref && typeof ref === 'object' ? (ref.en || '') : (ref || '');
    const gu = ref && typeof ref === 'object' ? (ref.gu || '') : '';
    let unitName = en || gu || (ref && typeof ref === 'object' ? (Object.values(ref)[0] || '') : '');
    if (en && gu && en !== gu) unitName = `${en} (${gu})`;

    const value = String(variant?.volume || '').trim();
    const showValue = value && value !== '1' && !(en && value.toLowerCase().includes(en.toLowerCase()));
    let label = unitName ? (showValue ? `${value} ${unitName}` : unitName) : value;
    if (variant?.extra && String(variant.extra).trim()) {
        label = `${String(variant.extra).trim()} ${label}`.trim();
    }
    return label || '-';
};

// Base-unit totals per variant from the inventory log (optionally for one godown / one variant)
const getVariantMovementTotals = async ({ godownId = null, variantId = null, transaction = null } = {}) => {
    return sequelize.query(
        `SELECT "variantId",
            COALESCE(SUM(CASE WHEN "type" = 'PURCHASE' THEN "totalQtyBaseUnits" ELSE 0 END), 0) AS "purchaseUnits",
            COALESCE(SUM(CASE WHEN "type" = 'SALE' THEN "totalQtyBaseUnits" ELSE 0 END), 0) AS "saleUnits",
            COALESCE(SUM(CASE
                WHEN "type" = 'SALES_RETURN' AND COALESCE("note", '') NOT ILIKE '%Damaged%' THEN "totalQtyBaseUnits"
                WHEN "type" = 'ADJUSTMENT' AND COALESCE("note", '') ILIKE '%Stock Restored%' THEN "totalQtyBaseUnits"
                ELSE 0 END), 0) AS "saleBackUnits"
        FROM "inventory_transactions"
        WHERE "deletedAt" IS NULL
          ${godownId ? 'AND "godownId" = :godownId' : ''}
          ${variantId ? 'AND "variantId" = :variantId' : ''}
        GROUP BY "variantId"`,
        { replacements: { godownId, variantId }, type: QueryTypes.SELECT, transaction }
    );
};

const getVariantStockUnits = async ({ godownId = null, variantId = null, transaction = null } = {}) => {
    return sequelize.query(
        `SELECT "variantId", COALESCE(SUM("totalBaseUnits"), 0) AS "units"
        FROM "inventory_stocks"
        WHERE "deletedAt" IS NULL
          AND "status" = 'Active'
          ${godownId ? 'AND "godownId" = :godownId' : ''}
          ${variantId ? 'AND "variantId" = :variantId' : ''}
        GROUP BY "variantId"`,
        { replacements: { godownId, variantId }, type: QueryTypes.SELECT, transaction }
    );
};

const getVariantAlertQty = (product, variant) => {
    const list = Array.isArray(product.lowStockVolumes) ? product.lowStockVolumes : [];
    const match = list.find((x) => x && x.volumeId && x.volumeId === variant.volumeId)
        || list.find((x) => x && x.volumeId && x.volumeId === variant.baseUnitLabel);
    if (match) return Number(match.qty || 0);
    if (product.lowStockVolumeId && [variant.volumeId, variant.baseUnitLabel].includes(product.lowStockVolumeId)) {
        return Number(product.lowStockQuantity || 0);
    }
    return null;
};

// PURCHASE entries per variant, newest first (unit rate is stored per base unit)
const getVariantPurchaseEntries = async ({ godownId = null } = {}) => {
    const rows = await sequelize.query(
        `SELECT "variantId", "totalQtyBaseUnits" AS "units", "purchasePricePerBaseUnit" AS "unitRate"
        FROM "inventory_transactions"
        WHERE "deletedAt" IS NULL
          AND "type" = 'PURCHASE'
          AND "totalQtyBaseUnits" > 0
          ${godownId ? 'AND "godownId" = :godownId' : ''}
        ORDER BY "variantId", "createdAt" DESC`,
        { replacements: { godownId }, type: QueryTypes.SELECT }
    );
    const map = new Map();
    rows.forEach((r) => {
        if (!map.has(r.variantId)) map.set(r.variantId, []);
        map.get(r.variantId).push({ units: Number(r.units || 0), unitRate: Number(r.unitRate || 0) });
    });
    return map;
};

// Per-base-unit rates are stored with 2 decimals; bring the pack rate back to the bill rate
const toPackRate = (unitRate, perPack, productRate) => {
    const raw = unitRate * perPack;
    const tolerance = perPack * 0.005 + 0.001;
    if (productRate > 0 && Math.abs(raw - productRate) <= tolerance) return productRate;
    if (Math.abs(raw - Math.round(raw)) <= tolerance) return Math.round(raw);
    return round2(raw);
};

// FIFO: stock lying now = the latest purchases (old stock is sold first).
// Anything not covered by a purchase (opening / adjustments) is valued at the product rate.
// With the purchase-bill hold ON, the first `oldStockLimitQty` packs are "selling now", the rest is on hold.
const buildStockLots = ({ availableUnits, purchases = [], perPack, productRate, holdActive, holdOldPacks }) => {
    if (availableUnits <= 0) return [];

    const lots = []; // oldest first
    let remaining = availableUnits;
    for (const p of purchases) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, p.units);
        lots.unshift({ units: take, rate: toPackRate(p.unitRate, perPack, productRate), fromOpening: false });
        remaining -= take;
    }
    if (remaining > 0) lots.unshift({ units: remaining, rate: productRate, fromOpening: true });

    let oldLeftUnits = holdActive ? Math.min(Math.round(holdOldPacks * perPack), availableUnits) : Infinity;
    const marked = [];
    for (const lot of lots) {
        if (oldLeftUnits >= lot.units) {
            marked.push({ ...lot, hold: false });
            oldLeftUnits -= lot.units;
        } else if (oldLeftUnits > 0) {
            marked.push({ ...lot, units: oldLeftUnits, hold: false });
            marked.push({ ...lot, units: lot.units - oldLeftUnits, hold: true });
            oldLeftUnits = 0;
        } else {
            marked.push({ ...lot, hold: true });
        }
    }

    const merged = [];
    for (const lot of marked) {
        const last = merged[merged.length - 1];
        if (last && last.rate === lot.rate && last.hold === lot.hold) last.units += lot.units;
        else merged.push({ ...lot });
    }
    return merged.map((l) => ({
        qty: round3(l.units / perPack),
        rate: l.rate,
        value: round2((l.units / perPack) * l.rate),
        hold: l.hold,
        fromOpening: l.fromOpening,
    }));
};

export const getVolumeWiseStock = async (req, res, next) => {
    try {
        const { search = '', status = '', godownId, mainCategoryId } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const scopeGodownId = godownId || null;

        const where = { status: { [Op.ne]: 'Deleted' } };
        if (mainCategoryId) where.mainCategoryId = mainCategoryId;

        const terms = String(search).trim().split(/\s+/).filter(Boolean);
        if (terms.length) {
            where[Op.and] = terms.map((term) => ({
                [Op.or]: [
                    { 'name.en': { [Op.iLike]: `%${term}%` } },
                    { 'name.gu': { [Op.iLike]: `%${term}%` } },
                    { 'name.hn': { [Op.iLike]: `%${term}%` } },
                    { serialNumber: { [Op.iLike]: `%${term}%` } },
                    { boxNumber: { [Op.iLike]: `%${term}%` } },
                    sequelize.literal(`EXISTS (SELECT 1 FROM unnest("Product"."keywords") AS k WHERE k ILIKE ${sequelize.escape(`%${term}%`)})`),
                ],
            }));
        }

        const [products, stockRows, movementRows, purchaseMap] = await Promise.all([
            Product.findAll({
                where,
                attributes: ['id', 'name', 'thumbnail', 'serialNumber', 'boxNumber', 'lowStockVolumeId', 'lowStockQuantity', 'lowStockVolumes', 'position', 'createdAt'],
                include: [
                    {
                        model: ProductVariant,
                        as: 'variants',
                        required: false,
                        attributes: ['id', 'volume', 'extra', 'volumeId', 'purchasePrice', 'baseUnitsPerPack', 'baseUnitLabel', 'innerUnitLabel', 'position', 'createdAt', 'status', 'oldStockLockToggle', 'oldStockLimitQty'],
                        include: [
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                        ],
                    },
                ],
                order: [
                    ['position', 'ASC'],
                    ['createdAt', 'DESC'],
                    [{ model: ProductVariant, as: 'variants' }, 'position', 'ASC'],
                    [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC'],
                ],
            }),
            getVariantStockUnits({ godownId: scopeGodownId }),
            getVariantMovementTotals({ godownId: scopeGodownId }),
            getVariantPurchaseEntries({ godownId: scopeGodownId }),
        ]);

        const stockMap = new Map(stockRows.map((r) => [r.variantId, Number(r.units || 0)]));
        const moveMap = new Map(movementRows.map((r) => [r.variantId, r]));

        const allRows = products.map((p) => {
            const product = p.toJSON();
            const variants = (product.variants || []).map((v) => {
                const perPack = Number(v.baseUnitsPerPack) > 0 ? Number(v.baseUnitsPerPack) : 1;
                const mv = moveMap.get(v.id) || {};
                const availableUnits = stockMap.get(v.id) || 0;
                const purchaseUnits = Number(mv.purchaseUnits || 0);
                const salesUnits = Number(mv.saleUnits || 0) - Number(mv.saleBackUnits || 0);
                const openingUnits = availableUnits - purchaseUnits + salesUnits;
                const productRate = Number(v.purchasePrice || 0);
                const available = availableUnits / perPack;
                const alertQty = getVariantAlertQty(product, v);

                const holdActive = !!v.oldStockLockToggle && Number(v.oldStockLimitQty || 0) > 0;
                const lots = buildStockLots({
                    availableUnits,
                    purchases: purchaseMap.get(v.id) || [],
                    perPack,
                    productRate,
                    holdActive,
                    holdOldPacks: Number(v.oldStockLimitQty || 0),
                });
                const rate = lots.length ? lots[0].rate : productRate; // rate of the stock being sold now
                const stockValue = lots.length
                    ? round2(lots.reduce((s, l) => s + l.value, 0))
                    : round2(available * productRate);
                const openingAmount = round2((openingUnits / perPack) * productRate);
                const purchaseAmount = round2((purchaseMap.get(v.id) || []).reduce((s, p) => s + (p.units / perPack) * toPackRate(p.unitRate, perPack, productRate), 0));
                const holdQty = round3(lots.filter((l) => l.hold).reduce((s, l) => s + l.qty, 0));

                let stockStatus = 'in';
                if (available <= 0) stockStatus = 'out';
                else if (alertQty != null && alertQty > 0 && available <= alertQty) stockStatus = 'low';

                return {
                    id: v.id,
                    volumeId: v.volumeId,
                    volumeLabel: getVolumeLabel(v),
                    innerUnitName: v.innerUnitRef?.name
                        ? (v.innerUnitRef.name.en || v.innerUnitRef.name.gu || Object.values(v.innerUnitRef.name)[0] || '')
                        : '',
                    perPack,
                    opening: round3(openingUnits / perPack),
                    purchase: round3(purchaseUnits / perPack),
                    sales: round3(salesUnits / perPack),
                    available: round3(available),
                    availableUnits,
                    rate,
                    productRate,
                    lots,
                    holdActive,
                    holdQty,
                    stockValue,
                    openingAmount,
                    purchaseAmount,
                    // FIFO cost of what went out, so Opening + Purchase − Sales = Stock Value
                    salesAmount: round2(openingAmount + purchaseAmount - stockValue),
                    alertQty,
                    stockStatus,
                };
            });

            const totalAvailable = variants.reduce((s, v) => s + v.availableUnits, 0);
            let status = 'in';
            if (!variants.length || totalAvailable <= 0) status = 'out';
            else if (variants.some((v) => v.alertQty != null && v.alertQty > 0 && v.available <= v.alertQty)) status = 'low';

            return {
                id: product.id,
                name: product.name,
                thumbnail: product.thumbnail,
                serialNumber: product.serialNumber,
                boxNumber: product.boxNumber,
                status,
                variants,
            };
        });

        const statusCounts = { '': allRows.length, in: 0, low: 0, out: 0 };
        allRows.forEach((r) => { statusCounts[r.status] += 1; });

        const filtered = ['in', 'low', 'out'].includes(status) ? allRows.filter((r) => r.status === status) : allRows;

        const totals = {
            openingAmount: 0,
            purchaseAmount: 0,
            salesAmount: 0,
            availableAmount: 0,
            outOfStockAmount: 0,
            outOfStockVolumes: 0,
        };
        filtered.forEach((r) => {
            r.variants.forEach((v) => {
                totals.openingAmount += v.openingAmount;
                totals.purchaseAmount += v.purchaseAmount;
                totals.salesAmount += v.salesAmount;
                if (v.available < 0) totals.outOfStockAmount += Math.abs(v.stockValue);
                else totals.availableAmount += v.stockValue;
                if (v.available <= 0) totals.outOfStockVolumes += 1;
            });
        });
        Object.keys(totals).forEach((k) => {
            if (k !== 'outOfStockVolumes') totals[k] = round2(totals[k]);
        });

        const totalRecords = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const currentPage = Math.min(page, totalPages);
        const data = filtered.slice((currentPage - 1) * limit, currentPage * limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Volume wise stock fetched successfully.', {
            data,
            totalRecords,
            totalPages,
            currentPage,
            statusCounts,
            totals,
        });
    } catch (error) {
        next(error);
    }
};

export const updateVolumeOpeningStock = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { variantId } = req.body;
        // Same godown as the list view (admin axios also sends the global godown as a query param)
        const godownId = req.body.godownId || req.query.godownId || null;
        const newOpening = Number(req.body.openingQty);

        if (!variantId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'variantId is required.');
        }
        if (req.body.openingQty === '' || req.body.openingQty == null || !Number.isFinite(newOpening) || newOpening < 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Opening must be zero or more.');
        }

        const variant = await ProductVariant.findByPk(variantId, { transaction: t });
        if (!variant) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product volume not found.');
        }
        const product = await Product.findOne({
            where: { id: variant.productId, status: { [Op.ne]: 'Deleted' } },
            transaction: t,
        });
        if (!product) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        }

        // Stock goes into the godown chosen on screen; with "All Godowns" it goes into the main godown.
        let godown = null;
        if (godownId) {
            godown = await validateGodown(godownId, t);
        } else {
            godown = await Godown.findOne({ where: { status: 'Active', type: 'main' }, order: [['createdAt', 'ASC']], transaction: t })
                || await Godown.findOne({ where: { status: 'Active' }, order: [['createdAt', 'ASC']], transaction: t });
        }
        if (!godown) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Godown not found.');
        }

        const perPack = Number(variant.baseUnitsPerPack) > 0 ? Number(variant.baseUnitsPerPack) : 1;
        const scopeGodownId = godownId ? godown.id : null;

        const rows = await InventoryStock.findAll({
            where: { variantId, godownId: godown.id, status: 'Active' },
            order: [['createdAt', 'DESC']],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });

        const [stockAgg] = await getVariantStockUnits({ godownId: scopeGodownId, variantId, transaction: t });
        const [movement] = await getVariantMovementTotals({ godownId: scopeGodownId, variantId, transaction: t });
        const availableUnits = Number(stockAgg?.units || 0);
        const purchaseUnits = Number(movement?.purchaseUnits || 0);
        const salesUnits = Number(movement?.saleUnits || 0) - Number(movement?.saleBackUnits || 0);
        const currentOpeningUnits = availableUnits - purchaseUnits + salesUnits;
        const targetOpeningUnits = Math.round(newOpening * perPack);
        const deltaUnits = targetOpeningUnits - currentOpeningUnits;

        if (deltaUnits === 0) {
            await t.rollback();
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Opening stock unchanged.', { opening: round3(currentOpeningUnits / perPack) });
        }

        const godownUnits = rows.reduce((s, r) => s + Number(r.totalBaseUnits || 0), 0);
        if (godownUnits + deltaUnits < 0) {
            await t.rollback();
            const minOpening = round3((currentOpeningUnits - godownUnits) / perPack);
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                `Opening cannot be less than ${Math.max(0, minOpening)} here, otherwise stock in ${godown.name} would go below zero.`
            );
        }

        const ratePerUnit = Number(variant.purchasePrice || 0) / perPack;
        const changes = [];

        if (deltaUnits > 0) {
            let row = rows[0];
            if (!row) {
                row = await InventoryStock.create({
                    productId: variant.productId,
                    variantId,
                    godownId: godown.id,
                    primaryUnitId: variant.baseUnitLabel || variant.volumeId || variant.innerUnitLabel || '00000000-0000-0000-0000-000000000000',
                    secondaryUnitId: variant.innerUnitLabel || null,
                    secondaryPerPrimary: perPack,
                    totalBaseUnits: 0,
                    avgPurchasePricePerBaseUnit: round2(ratePerUnit),
                    lastPurchasePricePerBaseUnit: round2(ratePerUnit),
                    status: 'Active',
                }, { transaction: t });
            }
            const oldUnits = Number(row.totalBaseUnits || 0);
            const oldAvg = Number(row.avgPurchasePricePerBaseUnit || 0);
            const newUnits = oldUnits + deltaUnits;
            const newAvg = oldUnits > 0 && ratePerUnit > 0
                ? ((oldUnits * oldAvg) + (deltaUnits * ratePerUnit)) / newUnits
                : (ratePerUnit > 0 ? ratePerUnit : oldAvg);
            await row.update({ totalBaseUnits: newUnits, avgPurchasePricePerBaseUnit: round2(newAvg) }, { transaction: t });
            changes.push({ row, change: deltaUnits, balance: newUnits, avg: newAvg });
        } else {
            let remaining = -deltaUnits;
            for (const row of rows) {
                if (remaining <= 0) break;
                const have = Number(row.totalBaseUnits || 0);
                if (have <= 0) continue;
                const take = Math.min(have, remaining);
                await row.update({ totalBaseUnits: have - take }, { transaction: t });
                changes.push({ row, change: -take, balance: have - take, avg: Number(row.avgPurchasePricePerBaseUnit || 0) });
                remaining -= take;
            }
        }

        const oldOpening = round3(currentOpeningUnits / perPack);
        for (const c of changes) {
            const split = splitBaseUnits(Math.abs(c.change), perPack);
            await InventoryTransaction.create({
                stockId: c.row.id,
                productId: variant.productId,
                variantId,
                godownId: godown.id,
                type: 'ADJUSTMENT',
                primaryUnitId: c.row.primaryUnitId,
                secondaryUnitId: c.row.secondaryUnitId || null,
                secondaryPerPrimary: Number(c.row.secondaryPerPrimary || perPack),
                qtyPrimary: split.qtyPrimary,
                qtySecondary: split.qtySecondary,
                totalQtyBaseUnits: c.change,
                purchasePricePerBaseUnit: c.change > 0 ? round2(ratePerUnit) : null,
                avgPriceAfterTxn: round2(c.avg),
                balanceAfterBaseUnits: c.balance,
                note: `Opening Stock Edit: ${oldOpening} → ${round3(newOpening)} (Volume Wise Stock)`,
                createdBy: getCreatorName(req),
            }, { transaction: t });
        }

        await t.commit();

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Opening stock changed from ${oldOpening} to ${round3(newOpening)} for product ID #${variant.productId} (${godown.name})`,
            metadata: { productId: variant.productId, variantId, godownId: godown.id, oldOpening, newOpening: round3(newOpening), deltaUnits },
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Opening stock updated successfully.', {
            opening: round3(newOpening),
            deltaUnits,
        });
    } catch (error) {
        await t.rollback();
        next(error);
    }
};
