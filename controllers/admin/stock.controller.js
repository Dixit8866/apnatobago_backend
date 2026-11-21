/**
 * Stock screens: summary (Opening / Purchase / Sales / Return / Transfer / Adjust / Closing),
 * ledger, lots, adjustments and the cut-off (Opening) module.
 * All stock changes go through services/stock.service.js.
 */
import { Op, QueryTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import {
    Product, ProductVariant, Volume, Godown, InventoryStock, InventoryTransaction, StockCutoff, StockOpeningCount,
    VendorOrder, SalesReturn, StockTransfer, Order, OrderItem, OutletOrder, OutletOrderItem, User,
} from '../../models/index.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { logActivity } from '../../helpers/activityLog.helper.js';
import { buildStockLines } from '../../helpers/inventory.helper.js';
import stockService, { MOVEMENT_LABELS, ADJUSTMENT_REASONS, perPackOf, round2, round4 } from '../../services/stock.service.js';

const nameOf = (obj, prefer = 'en') => {
    if (!obj) return '';
    if (typeof obj !== 'object') return String(obj);
    return obj[prefer] || obj.en || obj.gu || Object.values(obj)[0] || '';
};

const volumeLabel = (v) => {
    const unit = nameOf(v?.volumeRef?.name);
    const value = String(v?.volume || '').trim();
    const showValue = value && value !== '1' && !(unit && value.toLowerCase().includes(unit.toLowerCase()));
    let label = unit ? (showValue ? `${value} ${unit}` : unit) : value;
    if (v?.extra && String(v.extra).trim()) label = `${String(v.extra).trim()} ${label}`.trim();
    return label || 'Unit';
};

const baseUnitOf = (v) => v.innerUnitLabel || v.volumeId || v.baseUnitLabel || null;

/** Product's volumes, biggest pack first, with a display unit (main volume if set, else biggest pack). */
const describeUnits = (product) => {
    const variants = (product.variants || [])
        .map((v) => ({
            id: v.id,
            label: volumeLabel(v),
            perPack: perPackOf(v),
            purchasePrice: Number(v.purchasePrice || 0),
            volumeId: v.volumeId,
            baseUnitLabel: v.baseUnitLabel,
            innerUnitLabel: v.innerUnitLabel,
            innerUnitName: nameOf(v.innerUnitRef?.name),
        }))
        .sort((a, b) => b.perPack - a.perPack);
    const main = product.mainVolumeId
        ? variants.find((v) => v.volumeId === product.mainVolumeId || v.baseUnitLabel === product.mainVolumeId)
        : null;
    const display = main || variants[0] || null;
    const baseUnits = new Set((product.variants || []).map(baseUnitOf).filter(Boolean));
    const smallest = variants[variants.length - 1];
    return {
        variants,
        display,
        baseUnitName: smallest ? (smallest.perPack === 1 ? smallest.label : smallest.innerUnitName || 'unit') : 'unit',
        unitIssue: baseUnits.size > 1,
    };
};

const alertBaseUnits = (product, units) => {
    const list = Array.isArray(product.lowStockVolumes) ? product.lowStockVolumes : [];
    const entries = list.length ? list : (product.lowStockVolumeId ? [{ volumeId: product.lowStockVolumeId, qty: product.lowStockQuantity }] : []);
    let max = 0;
    for (const e of entries) {
        const qty = Number(e?.qty || 0);
        if (!e?.volumeId || qty <= 0) continue;
        const v = units.variants.find((x) => x.volumeId === e.volumeId || x.baseUnitLabel === e.volumeId);
        const perPack = v ? v.perPack : (units.variants.some((x) => x.innerUnitLabel === e.volumeId) ? 1 : null);
        if (perPack) max = Math.max(max, qty * perPack);
    }
    return max;
};

const parseDate = (val, fallback) => {
    if (!val) return fallback;
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? fallback : d;
};

const productWhere = ({ search, mainCategoryId }) => {
    const where = { status: { [Op.ne]: 'Deleted' }, isCombo: { [Op.not]: true } };
    if (mainCategoryId) where.mainCategoryId = mainCategoryId;
    const terms = String(search || '').trim().split(/\s+/).filter(Boolean);
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
    return where;
};

const loadProducts = (filters) =>
    Product.findAll({
        where: productWhere(filters),
        attributes: ['id', 'name', 'thumbnail', 'serialNumber', 'boxNumber', 'mainVolumeId', 'lowStockVolumes', 'lowStockVolumeId', 'lowStockQuantity', 'position', 'createdAt'],
        include: [
            {
                model: ProductVariant,
                as: 'variants',
                required: false,
                attributes: ['id', 'volume', 'extra', 'volumeId', 'baseUnitLabel', 'innerUnitLabel', 'baseUnitsPerPack', 'purchasePrice', 'status', 'oldStockLockToggle', 'oldStockLimitQty', 'newPricingData'],
                include: [
                    { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                ],
            },
        ],
        order: [['position', 'ASC'], ['createdAt', 'DESC']],
    });

const cutoffInfo = async () => {
    const [posted, draft] = await Promise.all([stockService.getPostedCutoff(), stockService.getDraftCutoff()]);
    return {
        posted: posted ? { id: posted.id, cutoffAt: posted.cutoffAt, postedBy: posted.postedBy, summary: posted.summary } : null,
        draft: draft ? { id: draft.id, createdAt: draft.createdAt, createdBy: draft.createdBy, title: draft.title } : null,
        strict: !!posted,
    };
};

/** Lots with stock (plus held lots) — for the "qty × rate" lines and the 🔒 hold marks. */
const loadLotRows = ({ godownId = null, productId = null } = {}) =>
    sequelize.query(
        `SELECT "productId", "godownId", "totalBaseUnits" AS units, COALESCE("unitCost", "avgPurchasePricePerBaseUnit", 0) AS cost,
                "pricingApplied", "createdAt"
         FROM inventory_stocks
         WHERE "deletedAt" IS NULL AND ("totalBaseUnits" > 0 OR "pricingApplied" = false)
           ${godownId ? 'AND "godownId" = :godownId' : ''} ${productId ? 'AND "productId" = :productId' : ''}
         ORDER BY "productId", "createdAt" ASC`,
        { replacements: { godownId, productId }, type: QueryTypes.SELECT }
    );

/** Oldest first; a lot is "hold" when it came in at or after a purchase whose new price is still waiting. */
const groupLotLines = (rows) => {
    const firstPending = new Map();
    for (const r of rows) {
        if (r.pricingApplied === false) {
            const key = `${r.productId}|${r.godownId}`;
            if (!firstPending.has(key)) firstPending.set(key, new Date(r.createdAt).getTime());
        }
    }
    const out = new Map();
    for (const r of rows) {
        const units = Number(r.units || 0);
        if (units <= 0) continue;
        const pend = firstPending.get(`${r.productId}|${r.godownId}`);
        const hold = pend !== undefined && new Date(r.createdAt).getTime() >= pend;
        const cost = Math.round(Number(r.cost || 0) * 10000) / 10000;
        const list = out.get(r.productId) || [];
        const last = list[list.length - 1];
        if (last && last.hold === hold && Math.abs(last.cost - cost) < 0.0001) last.units += units;
        else list.push({ units, cost, hold });
        out.set(r.productId, list);
    }
    return out;
};

/**
 * Selling prices that are lower than what the goods cost:
 *  - below the volume's purchase rate (product details), or
 *  - below the cost of the stock being sold now (oldest lot), when there is stock.
 * Held new prices (purchase-bill hold) are checked against their own new purchase rate ("upcoming").
 */
const sellingBelowPurchase = ({ variants, pricingByVariant, stockCostPerBase, pending = [] }) => {
    const issues = [];
    for (const v of variants) {
        const purchaseRate = Number(v.purchasePrice || 0);
        const stockCost = stockCostPerBase !== undefined ? round2(stockCostPerBase * v.perPack) : 0;
        const cost = Math.max(purchaseRate, stockCost);
        if (cost <= 0) continue;
        for (const p of pricingByVariant.get(v.id) || []) {
            const price = Number(p.price || 0);
            if (price <= 0 || price + 0.004 >= cost) continue;
            issues.push({
                variantId: v.id,
                volume: v.label,
                level: nameOf(p.levelName) || 'Level',
                minQty: p.minQty !== null ? Number(p.minQty) : null,
                maxQty: p.maxQty !== null ? Number(p.maxQty) : null,
                godownSpecific: !!p.godownId,
                price: round2(price),
                purchaseRate: round2(purchaseRate),
                stockCost,
                loss: round2(cost - price),
                upcoming: false,
            });
        }
    }
    for (const set of pending) {
        for (const pv of set?.variants || []) {
            const v = variants.find((x) => x.id === pv.variantId);
            const newRate = Number(pv.purchasePrice || v?.purchasePrice || 0);
            if (!v || newRate <= 0) continue;
            for (const p of pv.pricings || []) {
                const price = Number(p.price || 0);
                if (price <= 0 || price + 0.004 >= newRate) continue;
                issues.push({
                    variantId: v.id, volume: v.label, level: 'After hold', minQty: Number(p.minQty ?? 0), maxQty: Number(p.maxQty ?? 0),
                    godownSpecific: false, price: round2(price), purchaseRate: round2(newRate), stockCost: 0, loss: round2(newRate - price), upcoming: true,
                });
            }
        }
    }
    return issues.slice(0, 40);
};

/* ─────────────────────────── Stock summary ─────────────────────────── */

export const getStockSummary = async (req, res, next) => {
    try {
        const { search = '', status = '', godownId, mainCategoryId } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const cutoff = await cutoffInfo();
        const now = new Date();
        const defaultFrom = cutoff.posted?.cutoffAt ? new Date(cutoff.posted.cutoffAt) : new Date(0);
        const from = parseDate(req.query.from, defaultFrom);
        let to = parseDate(req.query.to, now);
        if (req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to))) to = new Date(`${req.query.to}T23:59:59.999`);
        if (to > now) to = now;
        const scope = godownId || null;
        const g = scope ? 'AND "godownId" = :scope' : '';
        const repl = { scope, from, to };

        const [products, lotRows, sellingRows, holdRows, moveRows, afterRows, lineRows, pricingRows, pendingRows] = await Promise.all([
            loadProducts({ search, mainCategoryId }),
            sequelize.query(
                `SELECT "productId",
                        COALESCE(SUM("totalBaseUnits"), 0) AS units,
                        COALESCE(SUM("totalBaseUnits" * COALESCE("unitCost", "avgPurchasePricePerBaseUnit", 0)), 0) AS value,
                        COUNT(*) FILTER (WHERE "totalBaseUnits" > 0) AS lots
                 FROM inventory_stocks WHERE "deletedAt" IS NULL ${g} GROUP BY "productId"`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            sequelize.query(
                `SELECT DISTINCT ON ("productId") "productId", COALESCE("unitCost", "avgPurchasePricePerBaseUnit", 0) AS cost
                 FROM inventory_stocks WHERE "deletedAt" IS NULL AND "totalBaseUnits" > 0 ${g}
                 ORDER BY "productId", "createdAt" ASC`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            sequelize.query(
                `WITH p AS (
                    SELECT "productId", "godownId", MIN("createdAt") AS t FROM inventory_stocks
                    WHERE "deletedAt" IS NULL AND "pricingApplied" = false GROUP BY 1, 2)
                 SELECT s."productId", COALESCE(SUM(s."totalBaseUnits"), 0) AS hold
                 FROM inventory_stocks s JOIN p ON p."productId" = s."productId" AND p."godownId" = s."godownId" AND s."createdAt" >= p.t
                 WHERE s."deletedAt" IS NULL ${scope ? 'AND s."godownId" = :scope' : ''} GROUP BY 1`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            sequelize.query(
                `SELECT "productId", movement, COALESCE(SUM("qtyChange"), 0) AS qty,
                        COALESCE(SUM("qtyChange" * COALESCE("unitCost", "avgPriceAfterTxn", 0)), 0) AS value
                 FROM inventory_transactions
                 WHERE "deletedAt" IS NULL AND movement IS NOT NULL AND "createdAt" > :from AND "createdAt" <= :to ${g}
                 GROUP BY 1, 2`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            sequelize.query(
                `SELECT "productId", COALESCE(SUM("qtyChange"), 0) AS qty,
                        COALESCE(SUM("qtyChange" * COALESCE("unitCost", "avgPriceAfterTxn", 0)), 0) AS value
                 FROM inventory_transactions
                 WHERE "deletedAt" IS NULL AND movement IS NOT NULL AND "createdAt" > :to ${g}
                 GROUP BY 1`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            loadLotRows({ godownId: scope }),
            sequelize.query(
                `SELECT pp."variantId", pp."godownId", pp."minQty", pp."maxQty", pp.price, cl.name AS "levelName"
                 FROM product_pricings pp
                 LEFT JOIN custom_levels cl ON cl.id = pp."customLevelId"
                 WHERE pp."deletedAt" IS NULL AND COALESCE(pp.status, 'Active') = 'Active'
                   ${scope ? 'AND (pp."godownId" IS NULL OR pp."godownId" = :scope)' : ''}`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
            sequelize.query(
                `SELECT "productId", "pricingData" FROM inventory_stocks
                 WHERE "deletedAt" IS NULL AND "pricingApplied" = false AND "pricingData" IS NOT NULL ${g}`,
                { replacements: repl, type: QueryTypes.SELECT }
            ),
        ]);
        const linesByProduct = groupLotLines(lineRows);
        const pricingByVariant = new Map();
        for (const pr of pricingRows) {
            if (!pricingByVariant.has(pr.variantId)) pricingByVariant.set(pr.variantId, []);
            pricingByVariant.get(pr.variantId).push(pr);
        }
        const pendingByProduct = new Map();
        for (const pr of pendingRows) {
            if (!pendingByProduct.has(pr.productId)) pendingByProduct.set(pr.productId, []);
            pendingByProduct.get(pr.productId).push(pr.pricingData);
        }

        const lotMap = new Map(lotRows.map((r) => [r.productId, r]));
        const sellingMap = new Map(sellingRows.map((r) => [r.productId, Number(r.cost || 0)]));
        const holdMap = new Map(holdRows.map((r) => [r.productId, Number(r.hold || 0)]));
        const afterMap = new Map(afterRows.map((r) => [r.productId, r]));
        const moveMap = new Map();
        for (const r of moveRows) {
            if (!moveMap.has(r.productId)) moveMap.set(r.productId, {});
            moveMap.get(r.productId)[r.movement] = { qty: Number(r.qty || 0), value: Number(r.value || 0) };
        }
        const mv = (m, ...keys) => keys.reduce((acc, k) => ({ qty: acc.qty + (m[k]?.qty || 0), value: acc.value + (m[k]?.value || 0) }), { qty: 0, value: 0 });

        const rows = products.map((p) => {
            const product = p.toJSON();
            const units = describeUnits(product);
            const lot = lotMap.get(product.id) || { units: 0, value: 0, lots: 0 };
            const after = afterMap.get(product.id) || { qty: 0, value: 0 };
            const m = moveMap.get(product.id) || {};

            const closing = Number(lot.units || 0) - Number(after.qty || 0);
            const closingValue = Number(lot.value || 0) - Number(after.value || 0);
            const purchase = mv(m, 'PURCHASE', 'MANUAL_IN');
            const salesNet = mv(m, 'SALE', 'SALE_REVERSAL', 'SALES_RETURN'); // negative = went out
            const returns = mv(m, 'SALES_RETURN');
            const transfer = mv(m, 'TRANSFER_IN', 'TRANSFER_OUT');
            const adjust = mv(m, 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'CUTOFF_ARCHIVE');
            const openingEdits = mv(m, 'OPENING');
            // Opening = everything that is not purchase or sale, so Opening + Purchase − Sales = Available always holds
            const opening = closing - purchase.qty - salesNet.qty;
            const openingValue = closingValue - purchase.value - salesNet.value;

            const alertBase = alertBaseUnits(product, units);
            const holdUnits = holdMap.get(product.id) || 0;
            let rowStatus = 'in';
            if (closing <= 0) rowStatus = 'out';
            else if (alertBase > 0 && closing <= alertBase) rowStatus = 'low';
            const displayPerPack = units.display?.perPack || 1;
            const sellingCost = sellingMap.get(product.id);
            const lines = (linesByProduct.get(product.id) || []).map((l) => ({ qty: l.units, rate: round2(l.cost * displayPerPack), hold: l.hold }));
            const priceIssues = sellingBelowPurchase({
                variants: units.variants,
                pricingByVariant,
                stockCostPerBase: closing > 0 ? sellingCost : undefined,
                pending: pendingByProduct.get(product.id) || [],
            });

            return {
                id: product.id,
                name: product.name,
                thumbnail: product.thumbnail,
                serialNumber: product.serialNumber,
                boxNumber: product.boxNumber,
                unit: units.display ? { id: units.display.id, label: units.display.label, perPack: displayPerPack } : null,
                baseUnitName: units.baseUnitName,
                variants: units.variants.map(({ id, label, perPack }) => ({ id, label, perPack })),
                unitIssue: units.unitIssue,
                opening,
                purchase: purchase.qty,
                sales: -salesNet.qty,
                closing,
                detail: {
                    returns: returns.qty,
                    transfer: transfer.qty,
                    adjust: adjust.qty,
                    openingEdits: openingEdits.qty,
                    before: opening - transfer.qty - adjust.qty - openingEdits.qty,
                },
                values: {
                    opening: round2(openingValue),
                    purchase: round2(purchase.value),
                    sales: round2(-salesNet.value),
                    closing: round2(closingValue),
                },
                rate: round2((sellingCost !== undefined ? sellingCost : (units.display ? units.display.purchasePrice / displayPerPack : 0)) * displayPerPack),
                lines,
                productRate: units.display ? units.display.purchasePrice : 0,
                alertBase,
                holdUnits,
                priceIssues,
                lots: Number(lot.lots || 0),
                status: rowStatus,
            };
        });

        const statusCounts = { '': rows.length, in: 0, low: 0, out: 0, hold: 0, loss: 0 };
        rows.forEach((r) => {
            statusCounts[r.status] += 1;
            if (r.holdUnits > 0) statusCounts.hold += 1;
            if (r.priceIssues.length) statusCounts.loss += 1;
        });
        const filtered = status === 'hold' ? rows.filter((r) => r.holdUnits > 0)
            : status === 'loss' ? rows.filter((r) => r.priceIssues.length > 0)
                : (['in', 'low', 'out'].includes(status) ? rows.filter((r) => r.status === status) : rows);

        const totals = filtered.reduce(
            (acc, r) => {
                acc.openingValue += r.values.opening;
                acc.purchaseValue += r.values.purchase;
                acc.salesValue += r.values.sales;
                acc.closingValue += r.values.closing;
                if (r.status === 'out') acc.outCount += 1;
                if (r.status === 'low') acc.lowCount += 1;
                return acc;
            },
            { openingValue: 0, purchaseValue: 0, salesValue: 0, closingValue: 0, outCount: 0, lowCount: 0 }
        );
        Object.keys(totals).forEach((k) => { if (k.endsWith('Value')) totals[k] = round2(totals[k]); });

        const totalRecords = filtered.length;
        const totalPages = Math.max(1, Math.ceil(totalRecords / limit));
        const currentPage = Math.min(page, totalPages);

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Stock summary fetched successfully.', {
            data: filtered.slice((currentPage - 1) * limit, currentPage * limit),
            totalRecords,
            totalPages,
            currentPage,
            statusCounts,
            totals,
            period: { from, to },
            cutoff,
        });
    } catch (error) {
        next(error);
    }
};

/* ─────────────────────────── Edit Stock (popup) ─────────────────────────── */

const SALE_MOVES = ['SALE', 'SALE_REVERSAL', 'SALES_RETURN'];
const PURCHASE_MOVES = ['PURCHASE', 'MANUAL_IN'];

/** One product in one godown for a period: opening / purchase / sales per volume + available. */
const productPeriod = async ({ productId, godownId, from, to, t = null }) => {
    const [lotAgg] = await sequelize.query(
        `SELECT COALESCE(SUM("totalBaseUnits"), 0) AS units,
                COALESCE(SUM("totalBaseUnits" * COALESCE("unitCost", "avgPurchasePricePerBaseUnit", 0)), 0) AS value
         FROM inventory_stocks WHERE "deletedAt" IS NULL AND "productId" = :productId AND "godownId" = :godownId`,
        { replacements: { productId, godownId }, type: QueryTypes.SELECT, transaction: t }
    );
    const [after] = await sequelize.query(
        `SELECT COALESCE(SUM("qtyChange"), 0) AS qty, COALESCE(SUM("qtyChange" * COALESCE("unitCost", "avgPriceAfterTxn", 0)), 0) AS value
         FROM inventory_transactions WHERE "deletedAt" IS NULL AND movement IS NOT NULL AND "productId" = :productId AND "godownId" = :godownId AND "createdAt" > :to`,
        { replacements: { productId, godownId, to }, type: QueryTypes.SELECT, transaction: t }
    );
    const moves = await sequelize.query(
        `SELECT movement, "variantId", COALESCE(SUM("qtyChange"), 0) AS qty
         FROM inventory_transactions
         WHERE "deletedAt" IS NULL AND movement IS NOT NULL AND "productId" = :productId AND "godownId" = :godownId
           AND "createdAt" > :from AND "createdAt" <= :to
         GROUP BY 1, 2`,
        { replacements: { productId, godownId, from, to }, type: QueryTypes.SELECT, transaction: t }
    );
    const closing = Number(lotAgg.units || 0) - Number(after.qty || 0);
    const closingValue = Number(lotAgg.value || 0) - Number(after.value || 0);
    const purchaseByVariant = new Map();
    const salesByVariant = new Map();
    let purchase = 0;
    let sales = 0;
    for (const m of moves) {
        const q = Number(m.qty || 0);
        if (PURCHASE_MOVES.includes(m.movement)) {
            purchase += q;
            purchaseByVariant.set(m.variantId, (purchaseByVariant.get(m.variantId) || 0) + q);
        } else if (SALE_MOVES.includes(m.movement)) {
            sales -= q;
            salesByVariant.set(m.variantId, (salesByVariant.get(m.variantId) || 0) - q);
        }
    }
    return { closing, closingValue, purchase, sales, opening: closing - purchase + sales, purchaseByVariant, salesByVariant };
};

/** Biggest volume first; the rest goes to the smallest volume. */
const splitIntoVolumes = (base, variants) => {
    const entries = {};
    let left = Math.max(0, Math.round(Number(base || 0)));
    variants.forEach((v, i) => {
        const isLast = i === variants.length - 1;
        const n = isLast ? left / v.perPack : Math.floor(left / v.perPack);
        entries[v.id] = n ? Math.round(n * 1000) / 1000 : 0;
        left -= Math.round(n * v.perPack);
    });
    return entries;
};

const periodFromQuery = async (q) => {
    const cutoff = await stockService.getPostedCutoff();
    const now = new Date();
    const from = parseDate(q.from, cutoff?.cutoffAt ? new Date(cutoff.cutoffAt) : new Date(0));
    let to = parseDate(q.to, now);
    if (to > now) to = now;
    return { from, to, isCurrent: !q.to || Math.abs(now - to) < 24 * 3600 * 1000 };
};

export const getStockEdit = async (req, res, next) => {
    try {
        const { productId, godownId } = req.query;
        if (!productId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId is required.');
        if (!godownId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Choose a godown first.');
        const [p] = await Product.findAll({
            where: { id: productId },
            attributes: ['id', 'name', 'thumbnail', 'serialNumber', 'boxNumber', 'mainVolumeId', 'lowStockVolumes', 'lowStockVolumeId', 'lowStockQuantity'],
            include: [{
                model: ProductVariant, as: 'variants', required: false,
                attributes: ['id', 'volume', 'extra', 'volumeId', 'baseUnitLabel', 'innerUnitLabel', 'baseUnitsPerPack', 'purchasePrice'],
                include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }, { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }],
            }],
        });
        if (!p) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        const product = p.toJSON();
        const units = describeUnits(product);
        const period = await periodFromQuery(req.query);
        const data = await productPeriod({ productId, godownId, from: period.from, to: period.to });

        // Opening split the user typed last time (if it still matches), else biggest volume first
        const lastOpening = await InventoryTransaction.findOne({
            where: { productId, godownId, movement: 'OPENING', meta: { [Op.ne]: null } },
            order: [['createdAt', 'DESC']],
        });
        const typed = lastOpening?.meta?.entries && Number(lastOpening.meta.openingBase) === data.opening ? lastOpening.meta.entries : null;
        const openingEntries = typed || splitIntoVolumes(data.opening, units.variants);

        const lowList = Array.isArray(product.lowStockVolumes) ? product.lowStockVolumes : [];
        const knownIds = new Set(units.variants.map((v) => v.id));
        const display = units.display;
        const lines = (groupLotLines(await loadLotRows({ godownId, productId })).get(productId) || [])
            .map((l) => ({ qty: l.units, rate: round2(l.cost * (display?.perPack || 1)), hold: l.hold }));

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Stock details fetched.', {
            product: { id: product.id, name: product.name, thumbnail: product.thumbnail, serialNumber: product.serialNumber, boxNumber: product.boxNumber },
            unit: display ? { id: display.id, label: display.label, perPack: display.perPack } : null,
            baseUnitName: units.baseUnitName,
            unitIssue: units.unitIssue,
            period: { from: period.from, to: period.to, isCurrent: period.isCurrent },
            variants: units.variants.map((v) => {
                // movements on a volume that no longer exists are shown on the display volume
                const extraP = v.id === display?.id ? [...data.purchaseByVariant].filter(([id]) => !knownIds.has(id)).reduce((s, [, q]) => s + q, 0) : 0;
                const extraS = v.id === display?.id ? [...data.salesByVariant].filter(([id]) => !knownIds.has(id)).reduce((s, [, q]) => s + q, 0) : 0;
                const purchaseBase = (data.purchaseByVariant.get(v.id) || 0) + extraP;
                const salesBase = (data.salesByVariant.get(v.id) || 0) + extraS;
                const alert = lowList.find((x) => x?.volumeId && (x.volumeId === v.volumeId || x.volumeId === v.baseUnitLabel));
                return {
                    id: v.id,
                    label: v.label,
                    perPack: v.perPack,
                    purchasePrice: v.purchasePrice,
                    alertQty: alert ? Number(alert.qty || 0) : null,
                    purchaseBase,
                    salesBase,
                    openingEntry: openingEntries[v.id] ?? 0,
                };
            }),
            totals: {
                openingBase: data.opening,
                purchaseBase: data.purchase,
                salesBase: data.sales,
                closingBase: data.closing,
                closingValue: round2(data.closingValue),
            },
            lines,
        });
    } catch (error) {
        next(error);
    }
};

export const saveStockEdit = async (req, res, next) => {
    try {
        const { productId, godownId, opening = null, rates = {}, alerts = null } = req.body;
        if (!productId || !godownId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Product and godown are required.');
        const godown = await Godown.findByPk(godownId);
        if (!godown) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Godown not found.');
        const product = await Product.findByPk(productId, {
            include: [{ model: ProductVariant, as: 'variants', required: false }],
        });
        if (!product) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        const pj = product.toJSON();
        const units = describeUnits(pj);
        const variants = pj.variants || [];
        const display = units.display;
        if (!display) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'This product has no volume.');
        const period = await periodFromQuery(req.body);
        const changes = [];

        await sequelize.transaction(async (t) => {
            // 1. Purchase rates (product details) — the main volume's new rate also revalues stock on hand
            let displayRate = Number(display.purchasePrice || 0);
            for (const v of variants) {
                if (rates[v.id] === undefined || rates[v.id] === '' || rates[v.id] === null) continue;
                const next = Number(rates[v.id]);
                if (!Number.isFinite(next) || next < 0) throw Object.assign(new Error('Purchase rate must be zero or more.'), { name: 'StockError' });
                if (Math.abs(next - Number(v.purchasePrice || 0)) < 0.005) continue;
                await ProductVariant.update({ purchasePrice: next }, { where: { id: v.id }, transaction: t });
                await sequelize.models.ProductPricing.update({ purchasePrice: next }, { where: { variantId: v.id }, transaction: t });
                changes.push(`rate ${volumeLabel(v)} ₹${Number(v.purchasePrice || 0)} → ₹${next}`);
                if (v.id === display.id) {
                    displayRate = next;
                    await stockService.revalueLots({ productId, unitCost: next / display.perPack, actor: req.user, note: `Rate ₹${Number(v.purchasePrice || 0)} → ₹${next} per ${display.label}` }, t);
                }
            }

            // 2. Alert qty per volume
            if (alerts && typeof alerts === 'object') {
                const list = Array.isArray(pj.lowStockVolumes) ? [...pj.lowStockVolumes] : [];
                for (const v of variants) {
                    if (!(v.id in alerts)) continue;
                    const volId = v.volumeId || v.baseUnitLabel;
                    if (!volId) continue;
                    const qty = alerts[v.id] === '' || alerts[v.id] === null ? 0 : Number(alerts[v.id]);
                    if (!Number.isFinite(qty) || qty < 0) throw Object.assign(new Error('Alert must be zero or more.'), { name: 'StockError' });
                    const idx = list.findIndex((x) => x?.volumeId === volId);
                    const before = idx >= 0 ? Number(list[idx].qty || 0) : 0;
                    if (qty > 0) { if (idx >= 0) list[idx] = { volumeId: volId, qty }; else list.push({ volumeId: volId, qty }); }
                    else if (idx >= 0) list.splice(idx, 1);
                    if (before !== qty) changes.push(`alert ${volumeLabel(v)} ${before} → ${qty}`);
                }
                await Product.update(
                    { lowStockVolumes: list, lowStockVolumeId: list[0]?.volumeId || null, lowStockQuantity: list[0]?.qty ?? null },
                    { where: { id: productId }, transaction: t }
                );
            }

            // 3. Opening: the difference goes in as an OPENING entry in this godown
            if (opening && typeof opening === 'object') {
                if (units.unitIssue) throw Object.assign(new Error('Fix the volume units of this product first (product details).'), { name: 'StockError' });
                if (!period.isCurrent) throw Object.assign(new Error('Opening can be changed only when the period ends today.'), { name: 'StockError' });
                let newBase = 0;
                const entries = {};
                for (const v of variants) {
                    const raw = opening[v.id];
                    if (raw === undefined || raw === '' || raw === null) continue;
                    const q = Number(raw);
                    if (!Number.isFinite(q) || q < 0) throw Object.assign(new Error('Opening must be zero or more.'), { name: 'StockError' });
                    entries[v.id] = q;
                    newBase += q * perPackOf(v);
                }
                newBase = Math.round(newBase);
                const cur = await productPeriod({ productId, godownId, from: period.from, to: new Date(), t });
                const delta = newBase - cur.opening;
                const meta = { entries, openingBase: newBase, before: cur.opening };
                const note = `Opening ${cur.opening} → ${newBase} (base units)`;
                const ref = { refType: 'MANUAL', refNo: 'OPENING' };
                if (delta > 0) {
                    await stockService.receive({ productId, godownId, variantId: display.id, qtyBase: delta, unitCost: displayRate / display.perPack, movement: 'OPENING', ref, note, actor: req.user, meta }, t);
                } else if (delta < 0) {
                    await stockService.issue({ productId, godownId, variantId: display.id, qtyBase: -delta, movement: 'OPENING', ref, note, actor: req.user, allowShortfall: false, meta }, t);
                }
                if (delta !== 0) changes.push(`opening ${cur.opening} → ${newBase}`);
            }
        });

        if (changes.length) {
            logActivity(req, {
                module: 'Stock Inventory',
                action: 'STOCK_UPDATE',
                description: `Edit Stock — ${nameOf(pj.name, 'en') || 'product'} (${godown.name}): ${changes.join(', ')}`,
                metadata: { productId, godownId, changes },
            });
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, changes.length ? 'Stock updated.' : 'Nothing changed.', { changes });
    } catch (error) {
        if (error.name === 'StockError') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, error.message);
        next(error);
    }
};

/* ─────────────────────────── Ledger & lots ─────────────────────────── */

const legacyQtyChange = (e) => {
    const q = Number(e.totalQtyBaseUnits || 0);
    if (e.type === 'SALE') return -Math.abs(q);
    if (e.type === 'PURCHASE' || e.type === 'SALES_RETURN') return Math.abs(q);
    return q;
};

export const getStockLedger = async (req, res, next) => {
    try {
        const { productId, godownId } = req.query;
        if (!productId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId is required.');
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
        const where = { productId };
        if (godownId) where.godownId = godownId;
        const from = parseDate(req.query.from, null);
        const to = parseDate(req.query.to, null);
        if (from || to) where.createdAt = { ...(from ? { [Op.gt]: from } : {}), ...(to ? { [Op.lte]: to } : {}) };

        const { rows, count } = await InventoryTransaction.findAndCountAll({
            where,
            include: [
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
                { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'extra', 'volumeId', 'baseUnitsPerPack'], include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }], paranoid: false },
            ],
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            limit,
            offset: (page - 1) * limit,
        });

        const data = rows.map((e) => {
            const legacy = !e.movement;
            const qtyChange = legacy ? legacyQtyChange(e) : Number(e.qtyChange || 0);
            const unitCost = e.unitCost !== null && e.unitCost !== undefined ? Number(e.unitCost) : Number(e.avgPriceAfterTxn || 0);
            return {
                id: e.id,
                createdAt: e.createdAt,
                movement: e.movement || e.type,
                label: legacy ? `${e.type} (old)` : (MOVEMENT_LABELS[e.movement] || e.movement),
                legacy,
                qtyChange,
                displayQty: e.movement === 'DAMAGED_RETURN' ? Number(e.totalQtyBaseUnits || 0) : null,
                unitCost: round4(unitCost),
                value: round2(qtyChange * unitCost),
                balanceAfter: legacy ? null : Number(e.balanceAfterBaseUnits || 0),
                refType: e.refType,
                refNo: e.refNo,
                note: e.note,
                reason: e.reason,
                createdBy: e.createdBy,
                godown: e.godown?.name || '',
                volume: e.variant ? volumeLabel(e.variant) : '',
            };
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Stock ledger fetched successfully.', {
            data,
            totalRecords: count,
            totalPages: Math.max(1, Math.ceil(count / limit)),
            currentPage: page,
        });
    } catch (error) {
        next(error);
    }
};

export const getProductLots = async (req, res, next) => {
    try {
        const { productId, godownId } = req.query;
        if (!productId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'productId is required.');
        const where = { productId, totalBaseUnits: { [Op.gt]: 0 } };
        if (godownId) where.godownId = godownId;
        const lots = await InventoryStock.findAll({
            where,
            include: [{ model: Godown, as: 'godown', attributes: ['id', 'name'] }],
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
        });
        const data = lots.map((l) => {
            const cost = l.unitCost !== null && l.unitCost !== undefined ? Number(l.unitCost) : Number(l.avgPurchasePricePerBaseUnit || 0);
            return {
                id: l.id,
                godown: l.godown?.name || '',
                godownId: l.godownId,
                source: MOVEMENT_LABELS[l.sourceType] || (l.sourceType ? l.sourceType : 'Old stock'),
                sourceRef: l.sourceRef || l.batchNumber || '',
                receivedAt: l.receivedAt || l.createdAt,
                received: l.receivedBaseUnits !== null && l.receivedBaseUnits !== undefined ? Number(l.receivedBaseUnits) : null,
                remaining: Number(l.totalBaseUnits || 0),
                unitCost: round4(cost),
                value: round2(Number(l.totalBaseUnits || 0) * cost),
                pricingPending: l.pricingApplied === false,
                expiryDate: l.expiryDate,
                batchNumber: l.batchNumber,
            };
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Stock lots fetched successfully.', { data });
    } catch (error) {
        next(error);
    }
};

/* ─────────────────────────── Adjustment ─────────────────────────── */

export const createStockAdjustment = async (req, res, next) => {
    try {
        const { productId, godownId, direction, quantities = {}, ratePerDisplayUnit, reason, note } = req.body;
        if (!productId || !godownId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Product and godown are required.');
        if (!['IN', 'OUT'].includes(direction)) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Choose stock in (+) or stock out (−).');
        if (!reason || !ADJUSTMENT_REASONS.includes(reason)) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Choose a reason for this adjustment.');
        if (reason === 'Other' && !String(note || '').trim()) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Write a note when the reason is "Other".');

        const godown = await Godown.findByPk(godownId);
        if (!godown) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Godown not found.');
        const variants = await ProductVariant.findAll({ where: { productId } });
        if (!variants.length) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Product has no volumes.');

        let qtyBase = 0;
        for (const [variantId, raw] of Object.entries(quantities || {})) {
            const v = variants.find((x) => x.id === variantId);
            const q = Number(raw || 0);
            if (!v || !Number.isFinite(q) || q < 0) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Quantities must be zero or more.');
            qtyBase += q * perPackOf(v);
        }
        qtyBase = Math.round(qtyBase);
        if (qtyBase <= 0) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Enter a quantity to adjust.');

        const display = [...variants].sort((a, b) => perPackOf(b) - perPackOf(a))[0];
        const rate = Number(ratePerDisplayUnit);
        const unitCost = direction === 'IN' && Number.isFinite(rate) && rate > 0 ? rate / perPackOf(display) : null;

        const before = await stockService.getProductBalance(productId, godownId);
        await stockService.adjust({ productId, godownId, variantId: display.id, direction, qtyBase, unitCost, reason, note: note || null, actor: req.user });
        const after = await stockService.getProductBalance(productId, godownId);

        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Stock adjustment ${direction === 'IN' ? '+' : '−'}${qtyBase} base units (${reason}) for product ID #${productId} in ${godown.name}`,
            metadata: { productId, godownId, direction, qtyBase, reason, before, after },
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Stock adjusted successfully.', { before, after, qtyBase });
    } catch (error) {
        if (error.name === 'StockError') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, error.message);
        next(error);
    }
};

export const getStockMeta = async (req, res, next) => {
    try {
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Stock settings fetched.', {
            reasons: ADJUSTMENT_REASONS,
            movements: MOVEMENT_LABELS,
            cutoff: await cutoffInfo(),
        });
    } catch (error) {
        next(error);
    }
};

/* ─────────────────────────── Cut-off (Opening) ─────────────────────────── */

const actorName = (req) => req.user?.fullname || req.user?.name || req.user?.username || 'Admin';

export const getCutoffs = async (req, res, next) => {
    try {
        const list = await StockCutoff.findAll({ order: [['createdAt', 'DESC']], limit: 20 });
        const counts = await sequelize.query(
            `SELECT "cutoffId", COUNT(*) AS rows, COUNT(DISTINCT "productId") AS products,
                    COALESCE(SUM("qtyBase" * "unitCost"), 0) AS value
             FROM stock_opening_counts GROUP BY "cutoffId"`,
            { type: QueryTypes.SELECT }
        );
        const countMap = new Map(counts.map((c) => [c.cutoffId, c]));
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Cut-offs fetched.', {
            data: list.map((c) => ({
                ...c.toJSON(),
                countedRows: Number(countMap.get(c.id)?.rows || 0),
                countedProducts: Number(countMap.get(c.id)?.products || 0),
                countedValue: round2(countMap.get(c.id)?.value || 0),
            })),
            cutoff: await cutoffInfo(),
        });
    } catch (error) {
        next(error);
    }
};

export const startCutoff = async (req, res, next) => {
    try {
        const existing = await stockService.getDraftCutoff();
        if (existing) return sendSuccessResponse(res, HTTP_STATUS.OK, 'A cut-off is already open.', existing);
        const cutoff = await StockCutoff.create({
            status: 'DRAFT',
            title: req.body?.title || `Stock count ${new Date().toLocaleDateString('en-IN')}`,
            note: req.body?.note || null,
            createdBy: actorName(req),
        });
        logActivity(req, { module: 'Stock Inventory', action: 'CREATE', description: `Started stock cut-off "${cutoff.title}"`, metadata: { cutoffId: cutoff.id } });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Cut-off started.', cutoff);
    } catch (error) {
        next(error);
    }
};

export const cancelCutoff = async (req, res, next) => {
    try {
        const cutoff = await StockCutoff.findByPk(req.params.id);
        if (!cutoff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Cut-off not found.');
        if (cutoff.status !== 'DRAFT') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Only an open (draft) cut-off can be cancelled.');
        await cutoff.update({ status: 'CANCELLED' });
        logActivity(req, { module: 'Stock Inventory', action: 'UPDATE', description: `Cancelled stock cut-off "${cutoff.title}"`, metadata: { cutoffId: cutoff.id } });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Cut-off cancelled.', cutoff);
    } catch (error) {
        next(error);
    }
};

// Stock already taken, goods still in the godown (Shipping = already on the vehicle, not counted anyway)
const PENDING_ORDER_STATUSES = ['Pending', 'Confirmed', 'Packaging', 'Packed'];

export const getCutoffChecklist = async (req, res, next) => {
    try {
        const cutoff = await StockCutoff.findByPk(req.params.id);
        if (!cutoff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Cut-off not found.');

        const products = await loadProducts({});
        const unitIssues = [];
        const noVolume = [];
        const zeroRate = [];
        const legacyHolds = [];
        for (const p of products) {
            const product = p.toJSON();
            const units = describeUnits(product);
            const name = nameOf(product.name, 'gu');
            if (!units.variants.length) noVolume.push({ id: product.id, name });
            if (units.unitIssue) {
                unitIssues.push({
                    id: product.id,
                    name,
                    volumes: (product.variants || []).map((v) => `${volumeLabel(v)} = ${perPackOf(v)} ${nameOf(v.innerUnitRef?.name) || '?'}`),
                });
            }
            for (const v of product.variants || []) {
                if (Number(v.purchasePrice || 0) <= 0) zeroRate.push({ id: product.id, name, volume: volumeLabel(v) });
                if (v.oldStockLockToggle && Array.isArray(v.newPricingData)) {
                    legacyHolds.push({
                        variantId: v.id,
                        productId: product.id,
                        name,
                        volume: volumeLabel(v),
                        oldQty: Number(v.oldStockLimitQty || 0),
                        currentRate: Number(v.purchasePrice || 0),
                        newRate: Number(v.newPricingData?.[0]?.purchasePrice || 0),
                        newPrices: v.newPricingData.map((x) => Number(x.price || 0)).filter(Boolean),
                    });
                }
            }
        }

        const [pendingVendorOrders, pendingReturns, pendingTransfers] = await Promise.all([
            VendorOrder.count({ where: { isConverted: false, status: { [Op.ne]: 'Cancelled' } } }),
            SalesReturn.count({ where: { status: 'Pending' } }),
            StockTransfer.count({ where: { status: { [Op.notIn]: ['Received', 'Cancelled'] } } }),
        ]);

        // Orders whose stock is already taken but goods may still be in the godown
        const [openOrders, openOutlet] = await Promise.all([
            Order.findAll({
                where: { orderStatus: { [Op.in]: PENDING_ORDER_STATUSES } },
                attributes: ['id', 'orderId', 'orderStatus', 'godownId', 'userId', 'createdAt'],
                include: [
                    { model: OrderItem, as: 'items', attributes: ['id', 'variantId', 'quantity', 'sellUnit'] },
                    { model: User, as: 'user', attributes: ['id', 'fullname'], required: false },
                ],
                order: [['createdAt', 'ASC']],
                limit: 500,
            }),
            OutletOrder.findAll({
                where: { orderStatus: { [Op.notIn]: ['Completed', 'Delivered', 'Cancelled', 'Admin Cancel'] } },
                attributes: ['id', 'orderId', 'orderStatus', 'godownId', 'customerName', 'shopName', 'createdAt'],
                order: [['createdAt', 'ASC']],
                limit: 500,
            }),
        ]);
        const productNameMap = new Map(products.map((p) => [p.id, nameOf(p.name, 'gu')]));
        const pendingByProduct = new Map();
        const addPending = (lines, godownId) => {
            for (const l of lines) {
                const key = `${l.productId}|${godownId || ''}`;
                const cur = pendingByProduct.get(key) || { productId: l.productId, godownId, name: productNameMap.get(l.productId) || 'Product', qtyBase: 0, orders: 0 };
                cur.qtyBase += l.qtyBase;
                cur.orders += 1;
                pendingByProduct.set(key, cur);
            }
        };
        const pendingOrders = [];
        for (const o of openOrders) {
            const lines = await buildStockLines(o.items || []);
            addPending(lines, o.godownId);
            pendingOrders.push({ type: 'App / Direct order', no: o.orderId, status: o.orderStatus, party: o.user?.fullname || '', lines: lines.length });
        }
        for (const o of openOutlet) {
            const items = await OutletOrderItem.findAll({ where: { outletOrderId: o.id }, attributes: ['variantId', 'quantity', 'sellUnit'] });
            const lines = await buildStockLines(items);
            addPending(lines, o.godownId);
            pendingOrders.push({ type: 'Outlet order', no: o.orderId, status: o.orderStatus, party: o.shopName || o.customerName || '', lines: lines.length });
        }
        const godowns = await Godown.findAll({ attributes: ['id', 'name'] });
        const godownName = new Map(godowns.map((gd) => [gd.id, gd.name]));
        const unitsByProduct = new Map(products.map((p) => [p.id, describeUnits(p.toJSON())]));
        const setAside = [...pendingByProduct.values()].map((x) => {
            const u = unitsByProduct.get(x.productId);
            return {
                ...x,
                godown: godownName.get(x.godownId) || '',
                unit: u?.display ? { label: u.display.label, perPack: u.display.perPack } : null,
                variants: (u?.variants || []).map(({ id, label, perPack }) => ({ id, label, perPack })),
            };
        });

        const countStats = await sequelize.query(
            `SELECT "godownId", COUNT(*) AS rows, COALESCE(SUM("qtyBase" * "unitCost"), 0) AS value
             FROM stock_opening_counts WHERE "cutoffId" = :id GROUP BY "godownId"`,
            { replacements: { id: cutoff.id }, type: QueryTypes.SELECT }
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Checklist fetched.', {
            cutoff,
            master: { unitIssues, noVolume, zeroRate },
            pending: { vendorOrders: pendingVendorOrders, salesReturns: pendingReturns, transfers: pendingTransfers },
            pendingOrders,
            setAside,
            legacyHolds,
            counts: countStats.map((c) => ({ godownId: c.godownId, godown: godownName.get(c.godownId) || '', rows: Number(c.rows), value: round2(c.value) })),
            canPost: cutoff.status === 'DRAFT' && unitIssues.length === 0 && noVolume.length === 0,
        });
    } catch (error) {
        next(error);
    }
};

export const getCutoffCounts = async (req, res, next) => {
    try {
        const cutoff = await StockCutoff.findByPk(req.params.id);
        if (!cutoff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Cut-off not found.');
        const { godownId, mainCategoryId, search } = req.query;
        if (!godownId) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Choose a godown.');

        const [products, counts, systemRows] = await Promise.all([
            loadProducts({ search, mainCategoryId }),
            StockOpeningCount.findAll({ where: { cutoffId: cutoff.id, godownId } }),
            sequelize.query(
                `SELECT "productId", COALESCE(SUM("totalBaseUnits"), 0) AS units FROM inventory_stocks
                 WHERE "deletedAt" IS NULL AND "godownId" = :godownId GROUP BY "productId"`,
                { replacements: { godownId }, type: QueryTypes.SELECT }
            ),
        ]);
        const countMap = new Map(counts.map((c) => [c.productId, c]));
        const systemMap = new Map(systemRows.map((r) => [r.productId, Number(r.units || 0)]));

        const data = products.map((p) => {
            const product = p.toJSON();
            const units = describeUnits(product);
            const c = countMap.get(product.id);
            const displayPerPack = units.display?.perPack || 1;
            return {
                id: product.id,
                name: product.name,
                serialNumber: product.serialNumber,
                boxNumber: product.boxNumber,
                variants: units.variants.map(({ id, label, perPack }) => ({ id, label, perPack })),
                unit: units.display ? { id: units.display.id, label: units.display.label, perPack: displayPerPack } : null,
                unitIssue: units.unitIssue,
                defaultRate: units.display ? units.display.purchasePrice : 0,
                systemBase: systemMap.get(product.id) || 0,
                counted: !!c,
                entries: c?.entries || {},
                qtyBase: c ? Number(c.qtyBase) : null,
                rate: c ? round2(Number(c.unitCost) * displayPerPack) : null,
                note: c?.note || '',
                updatedBy: c?.updatedBy || null,
            };
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Counts fetched.', { cutoff, data });
    } catch (error) {
        next(error);
    }
};

export const saveCutoffCounts = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const cutoff = await StockCutoff.findByPk(req.params.id, { transaction: t });
        if (!cutoff) { await t.rollback(); return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Cut-off not found.'); }
        if (cutoff.status !== 'DRAFT') { await t.rollback(); return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'This cut-off is already closed.'); }
        const { godownId, rows = [] } = req.body;
        const godown = godownId ? await Godown.findByPk(godownId, { transaction: t }) : null;
        if (!godown) { await t.rollback(); return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Choose a godown.'); }

        let saved = 0;
        let removed = 0;
        for (const row of rows) {
            if (!row?.productId) continue;
            const variants = await ProductVariant.findAll({ where: { productId: row.productId }, transaction: t });
            if (!variants.length) continue;
            const entries = {};
            let qtyBase = 0;
            for (const [variantId, raw] of Object.entries(row.entries || {})) {
                if (raw === '' || raw === null || raw === undefined) continue;
                const v = variants.find((x) => x.id === variantId);
                const q = Number(raw);
                if (!v || !Number.isFinite(q) || q < 0) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Counts must be zero or more.');
                }
                entries[variantId] = q;
                qtyBase += q * perPackOf(v);
            }
            const existing = await StockOpeningCount.findOne({ where: { cutoffId: cutoff.id, productId: row.productId, godownId }, transaction: t });
            if (!Object.keys(entries).length) {
                if (existing) { await existing.destroy({ transaction: t }); removed += 1; }
                continue;
            }
            const display = [...variants].sort((a, b) => perPackOf(b) - perPackOf(a))[0];
            const rate = Number(row.rate);
            const unitCost = Number.isFinite(rate) && rate >= 0 && row.rate !== '' && row.rate !== null && row.rate !== undefined
                ? rate / perPackOf(display)
                : Number(display.purchasePrice || 0) / perPackOf(display);
            const payload = { entries, qtyBase: Math.round(qtyBase), unitCost: round4(unitCost), note: row.note || null, updatedBy: actorName(req) };
            if (existing) await existing.update(payload, { transaction: t });
            else await StockOpeningCount.create({ cutoffId: cutoff.id, productId: row.productId, godownId, ...payload }, { transaction: t });
            saved += 1;
        }
        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Counts saved.', { saved, removed });
    } catch (error) {
        await t.rollback();
        next(error);
    }
};

export const postCutoffOpening = async (req, res, next) => {
    try {
        const cutoff = await StockCutoff.findByPk(req.params.id);
        if (!cutoff) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Cut-off not found.');
        if (cutoff.status !== 'DRAFT') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'This cut-off is already closed.');
        if (String(req.body?.confirm || '').trim().toUpperCase() !== 'POST') {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Type POST to confirm.');
        }
        const products = await loadProducts({});
        const blocking = products.filter((p) => {
            const units = describeUnits(p.toJSON());
            return units.unitIssue || !units.variants.length;
        });
        if (blocking.length) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Fix the volume units of ${blocking.length} product(s) first (see Master Check).`);
        }
        const posted = await stockService.postCutoff({ cutoffId: cutoff.id, actor: req.user });
        logActivity(req, {
            module: 'Stock Inventory',
            action: 'STOCK_UPDATE',
            description: `Posted stock cut-off "${posted.title}" — opening value ₹${posted.summary?.openingValue}`,
            metadata: { cutoffId: posted.id, summary: posted.summary },
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Opening stock posted.', posted);
    } catch (error) {
        if (error.name === 'StockError') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, error.message);
        next(error);
    }
};

/** Old purchase-bill hold (before lot pricing): make the new prices live now, or drop the hold. */
export const resolveLegacyHold = async (req, res, next) => {
    try {
        const { variantId } = req.params;
        const { action } = req.body;
        const variant = await ProductVariant.findByPk(variantId);
        if (!variant) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Volume not found.');
        if (!variant.oldStockLockToggle || !Array.isArray(variant.newPricingData)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'This volume has no old hold.');
        }
        await sequelize.transaction(async (t) => {
            if (action === 'apply') {
                const newRate = Number(variant.newPricingData?.[0]?.purchasePrice || 0);
                await stockService.applyPricingSet({ variants: [{ variantId: variant.id, purchasePrice: newRate, pricings: variant.newPricingData }] }, null, t);
            } else if (action !== 'cancel') {
                throw Object.assign(new Error('Action must be apply or cancel.'), { name: 'StockError' });
            }
            await variant.update({ oldStockLockToggle: false, oldStockLimitQty: 0, newPricingData: null }, { transaction: t });
        });
        logActivity(req, {
            module: 'Stock Inventory',
            action: 'UPDATE',
            description: `Old purchase hold ${action === 'apply' ? 'applied (new prices live)' : 'cancelled'} for volume #${variantId}`,
            metadata: { variantId, action },
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, action === 'apply' ? 'New prices are live.' : 'Hold removed.');
    } catch (error) {
        if (error.name === 'StockError') return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, error.message);
        next(error);
    }
};
