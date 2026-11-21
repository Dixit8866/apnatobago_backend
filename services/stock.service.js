/**
 * Stock Service — the only place that changes stock.
 *
 * Rules
 *  1. One product = one stock per godown, counted in the product's base unit (smallest unit).
 *     Every volume (Box, Dando, Kato …) is a multiple of that base unit (baseUnitsPerPack).
 *  2. Every change writes a ledger entry (inventory_transactions) with movement, signed qty,
 *     cost, reference (order / bill / transfer …), user and reason. No entry, no change.
 *  3. Every receipt is a lot (inventory_stocks row) with its own cost per base unit.
 *     Stock always goes out from the oldest lot first (FIFO), only from the given godown.
 *  4. A purchase-bill "hold" stores the new selling prices on the new lot; they go live
 *     automatically when the older lots in that godown are sold out.
 *  5. After the first cut-off (Opening) is posted, stock can never go below zero.
 */
import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';
import InventoryTransaction from '../models/superadmin-models/InventoryTransaction.js';
import ProductVariant from '../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../models/superadmin-models/ProductPricing.js';
import Product from '../models/superadmin-models/Product.js';
import Godown from '../models/superadmin-models/Godown.js';
import StockCutoff from '../models/superadmin-models/StockCutoff.js';
import StockOpeningCount from '../models/superadmin-models/StockOpeningCount.js';
import logger from '../logger/apiLogger.js';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export const MOVEMENT_LABELS = {
    OPENING: 'Opening',
    PURCHASE: 'Purchase',
    MANUAL_IN: 'Stock In (no bill)',
    SALE: 'Sale',
    SALE_REVERSAL: 'Sale reversed',
    SALES_RETURN: 'Sales return',
    DAMAGED_RETURN: 'Damaged return',
    TRANSFER_IN: 'Transfer in',
    TRANSFER_OUT: 'Transfer out',
    ADJUSTMENT_IN: 'Adjustment +',
    ADJUSTMENT_OUT: 'Adjustment −',
    CUTOFF_ARCHIVE: 'Closed at cut-off',
    REVALUE: 'Rate updated',
    PURCHASE_RETURN: 'Purchase return',
};

// Old `type` column kept for screens that still read it
const LEGACY_TYPE = {
    OPENING: 'ADJUSTMENT',
    PURCHASE: 'PURCHASE',
    MANUAL_IN: 'PURCHASE',
    SALE: 'SALE',
    SALE_REVERSAL: 'ADJUSTMENT',
    SALES_RETURN: 'SALES_RETURN',
    DAMAGED_RETURN: 'SALES_RETURN',
    TRANSFER_IN: 'ADJUSTMENT',
    TRANSFER_OUT: 'ADJUSTMENT',
    ADJUSTMENT_IN: 'ADJUSTMENT',
    ADJUSTMENT_OUT: 'ADJUSTMENT',
    CUTOFF_ARCHIVE: 'ADJUSTMENT',
    REVALUE: 'ADJUSTMENT',
    PURCHASE_RETURN: 'ADJUSTMENT',
};

export const ADJUSTMENT_REASONS = ['Shortage', 'Damage', 'Expired', 'Excess', 'Count correction', 'Other'];

export class StockError extends Error {
    constructor(message, details = null) {
        super(message);
        this.name = 'StockError';
        this.statusCode = 400;
        this.details = details;
    }
}

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const round4 = (n) => Math.round(Number(n || 0) * 10000) / 10000;

export const perPackOf = (variant) => (Number(variant?.baseUnitsPerPack) > 0 ? Number(variant.baseUnitsPerPack) : 1);

/** Qty in an order line → base units (same rule every sale screen uses). */
export const toBaseUnits = (quantity, sellUnit, variant) =>
    Math.round(sellUnit === 'Inner' ? Number(quantity || 0) : Number(quantity || 0) * perPackOf(variant));

const actorInfo = (actor) => {
    if (!actor) return { name: 'System', id: null };
    if (typeof actor === 'string') return { name: actor, id: null };
    return {
        name: actor.fullname || actor.name || actor.username || actor.number || 'Admin',
        id: actor.id ? String(actor.id) : null,
    };
};

const withTx = (transaction, fn) => (transaction ? fn(transaction) : sequelize.transaction((t) => fn(t)));

const unitFields = (variant) => ({
    primaryUnitId: variant.baseUnitLabel || variant.volumeId || variant.innerUnitLabel || ZERO_UUID,
    secondaryUnitId: variant.innerUnitLabel || null,
    secondaryPerPrimary: perPackOf(variant),
});

export const lotCost = (lot) =>
    lot && lot.unitCost !== null && lot.unitCost !== undefined ? Number(lot.unitCost) : Number(lot?.avgPurchasePricePerBaseUnit || 0);

const defaultUnitCost = (variant) => {
    const price = Number(variant?.purchasePrice || 0);
    return price > 0 ? price / perPackOf(variant) : 0;
};

/** The product's biggest pack (e.g. Dando) — used to label opening / product-level lots. */
export const getDisplayVariant = async (productId, t) => {
    const variants = await ProductVariant.findAll({ where: { productId }, transaction: t });
    if (!variants.length) return null;
    return variants.sort((a, b) => perPackOf(b) - perPackOf(a))[0];
};

export const getProductBalance = async (productId, godownId, t) =>
    Number((await InventoryStock.sum('totalBaseUnits', { where: { productId, godownId }, transaction: t })) || 0);

export const getPostedCutoff = (t) =>
    StockCutoff.findOne({ where: { status: 'POSTED' }, order: [['cutoffAt', 'DESC']], transaction: t });

export const getDraftCutoff = (t) =>
    StockCutoff.findOne({ where: { status: 'DRAFT' }, order: [['createdAt', 'DESC']], transaction: t });

/** After the first cut-off, stock can never go negative. */
export const isStrictMode = async (t) => (await StockCutoff.count({ where: { status: 'POSTED' }, transaction: t })) > 0;

/**
 * Stock of this product in this godown is trusted (never below zero) once its Opening has been
 * set (Edit Stock), or after a cut-off. Before that, old data may be short, so a shortfall is only logged.
 */
export const isStrictFor = async (productId, godownId, t) => {
    if (await isStrictMode(t)) return true;
    const opening = await InventoryTransaction.count({ where: { productId, godownId, movement: 'OPENING' }, transaction: t });
    return opening > 0;
};

const productLabel = async (productId, t) => {
    const p = await Product.findByPk(productId, { attributes: ['id', 'name'], transaction: t, paranoid: false });
    const n = p?.name;
    return (n && typeof n === 'object' ? n.gu || n.en || Object.values(n)[0] : n) || 'Product';
};

const writeEntry = async (
    { lot, productId, variantId, godownId, movement, qtyChange, unitCost, ref = {}, reason = null, note = null, actor = null, sourceEntryId = null, balanceAfter = 0, displayQty = null, meta = null },
    t
) => {
    const who = actorInfo(actor);
    const spp = Number(lot.secondaryPerPrimary) > 0 ? Number(lot.secondaryPerPrimary) : 1;
    const absQty = Math.abs(displayQty !== null ? displayQty : qtyChange);
    const legacyType = LEGACY_TYPE[movement] || 'ADJUSTMENT';
    return InventoryTransaction.create(
        {
            stockId: lot.id,
            productId,
            variantId: variantId || lot.variantId,
            godownId,
            type: legacyType,
            movement,
            primaryUnitId: lot.primaryUnitId || ZERO_UUID,
            secondaryUnitId: lot.secondaryUnitId || null,
            secondaryPerPrimary: spp,
            qtyPrimary: Math.floor(absQty / spp),
            qtySecondary: absQty % spp,
            totalQtyBaseUnits: legacyType === 'ADJUSTMENT' ? qtyChange : absQty,
            qtyChange,
            unitCost: round4(unitCost),
            purchasePricePerBaseUnit: qtyChange > 0 ? round2(unitCost) : null,
            avgPriceAfterTxn: round2(unitCost),
            balanceAfterBaseUnits: Math.round(balanceAfter),
            refType: ref?.refType || null,
            refId: ref?.refId !== undefined && ref?.refId !== null ? String(ref.refId) : null,
            refNo: ref?.refNo !== undefined && ref?.refNo !== null ? String(ref.refNo) : null,
            reason,
            note,
            createdBy: who.name,
            createdById: who.id,
            sourceEntryId,
            meta,
        },
        { transaction: t }
    );
};

const createLot = async ({ productId, godownId, variant, qtyBase, unitCost, movement, ref, pricingData = null, expiryDate = null, batchNumber = null, receivedAt = null }, t) =>
    InventoryStock.create(
        {
            productId,
            variantId: variant.id,
            godownId,
            ...unitFields(variant),
            totalBaseUnits: qtyBase,
            receivedBaseUnits: qtyBase,
            unitCost: round4(unitCost),
            avgPurchasePricePerBaseUnit: round2(unitCost),
            lastPurchasePricePerBaseUnit: round2(unitCost),
            expiryDate: expiryDate || null,
            batchNumber: batchNumber || null,
            status: 'Active',
            sourceType: movement,
            sourceRef: ref?.refNo ? String(ref.refNo) : null,
            pricingData: pricingData || null,
            pricingApplied: !pricingData,
            receivedAt: receivedAt || new Date(),
        },
        { transaction: t }
    );

const resolveVariant = async (productId, variantId, t) => {
    let variant = variantId ? await ProductVariant.findByPk(variantId, { transaction: t, paranoid: false }) : null;
    if (!variant || variant.productId !== productId) variant = await getDisplayVariant(productId, t);
    return variant;
};

/* ───────────────────────────── Selling price hold ───────────────────────────── */

/** Make a stored price set live: purchase rate + level pricing (global and the lot's godown). */
export const applyPricingSet = async (pricingData, godownId, t) => {
    const variants = Array.isArray(pricingData?.variants) ? pricingData.variants : [];
    for (const v of variants) {
        if (!v?.variantId) continue;
        const purchasePrice = Number(v.purchasePrice || 0);
        if (purchasePrice > 0) {
            await ProductVariant.update({ purchasePrice }, { where: { id: v.variantId }, transaction: t });
        }
        const pricings = Array.isArray(v.pricings) ? v.pricings.filter((p) => p && p.customLevelId && p.price !== undefined && p.price !== '') : [];
        if (!pricings.length) continue;
        // scope 'godown' = only this godown's pricing; otherwise global (live) + this godown
        const scopes = pricingData?.scope === 'godown' && godownId ? [godownId] : (godownId ? [null, godownId] : [null]);
        for (const scope of scopes) {
            await ProductPricing.destroy({ where: { variantId: v.variantId, godownId: scope }, transaction: t });
            for (const p of pricings) {
                await ProductPricing.create(
                    {
                        variantId: v.variantId,
                        godownId: scope,
                        customLevelId: p.customLevelId,
                        quantityRange: `${p.minQty}-${p.maxQty}`,
                        minQty: p.minQty,
                        maxQty: p.maxQty,
                        purchasePrice: purchasePrice > 0 ? purchasePrice : Number(p.purchasePrice || 0),
                        price: p.price,
                        mrp: p.mrp || p.price,
                        status: 'Active',
                    },
                    { transaction: t }
                );
            }
        }
    }
};

/**
 * Re-check pending price sets for a product: a lot's prices go live once no older lot
 * in its godown has stock left. While one is pending, the variant hold fields tell the
 * app how much can still be sold at the current price.
 */
export const refreshHoldState = async (productId, t) => {
    const pending = await InventoryStock.findAll({
        where: { productId, pricingApplied: false },
        order: [['createdAt', 'ASC'], ['id', 'ASC']],
        transaction: t,
    });
    const variants = await ProductVariant.findAll({ where: { productId }, transaction: t });
    const lotManaged = variants.some((v) => v.newPricingData && !Array.isArray(v.newPricingData) && v.newPricingData.lotManaged);

    for (const lot of pending) {
        const older = Number(
            (await InventoryStock.sum('totalBaseUnits', {
                where: { productId, godownId: lot.godownId, createdAt: { [Op.lt]: lot.createdAt }, totalBaseUnits: { [Op.gt]: 0 } },
                transaction: t,
            })) || 0
        );
        if (older > 0) {
            for (const v of variants) {
                await v.update(
                    {
                        oldStockLockToggle: true,
                        oldStockLimitQty: Math.floor((older / perPackOf(v)) * 100) / 100,
                        newPricingData: { lotManaged: true, lotId: lot.id, godownId: lot.godownId },
                    },
                    { transaction: t }
                );
            }
            return { holdActive: true, oldBaseUnits: older, lotId: lot.id };
        }
        if (lot.pricingData) await applyPricingSet(lot.pricingData, lot.godownId, t);
        await lot.update({ pricingApplied: true }, { transaction: t });
    }

    if (lotManaged) {
        for (const v of variants) {
            await v.update({ oldStockLockToggle: false, oldStockLimitQty: 0, newPricingData: null }, { transaction: t });
        }
    }
    return { holdActive: false };
};

/* ───────────────────────────── Core movements ───────────────────────────── */

/** Stock in: creates a new lot + ledger entry. */
export const receive = async (opts, transaction) =>
    withTx(transaction, async (t) => {
        const {
            productId, godownId, variantId = null, unitCost = null, movement = 'PURCHASE', ref = {}, reason = null, note = null,
            actor = null, pricingData = null, expiryDate = null, batchNumber = null, receivedAt = null, sourceEntryId = null,
            skipHoldRefresh = false, meta = null,
        } = opts;
        const qtyBase = Math.round(Number(opts.qtyBase));
        if (!productId || !godownId) throw new StockError('Product and godown are required to add stock.');
        if (!Number.isFinite(qtyBase) || qtyBase <= 0) throw new StockError('Stock quantity must be more than zero.');

        const variant = await resolveVariant(productId, variantId, t);
        if (!variant) throw new StockError('This product has no volume. Add a volume in product details first.');

        const cost = unitCost !== null && unitCost !== undefined && unitCost !== '' && Number.isFinite(Number(unitCost)) && Number(unitCost) >= 0
            ? Number(unitCost)
            : defaultUnitCost(variant);

        const lot = await createLot({ productId, godownId, variant, qtyBase, unitCost: cost, movement, ref, pricingData, expiryDate, batchNumber, receivedAt }, t);
        const balanceAfter = await getProductBalance(productId, godownId, t);
        const entry = await writeEntry(
            { lot, productId, variantId: variantId || variant.id, godownId, movement, qtyChange: qtyBase, unitCost: cost, ref, reason, note, actor, sourceEntryId, balanceAfter, meta },
            t
        );
        if (!skipHoldRefresh) await refreshHoldState(productId, t);
        return { lot, entry, unitCost: cost };
    });

/**
 * Stock out from one godown, oldest lot first.
 * Before the first cut-off a shortfall is only logged (old data is not reliable yet);
 * after it, or with allowShortfall=false, a shortfall stops the action.
 */
export const issue = async (opts, transaction) =>
    withTx(transaction, async (t) => {
        const { productId, godownId, variantId = null, movement = 'SALE', ref = {}, reason = null, note = null, actor = null, allowShortfall = true, meta = null } = opts;
        const qtyBase = Math.round(Number(opts.qtyBase));
        if (!Number.isFinite(qtyBase) || qtyBase <= 0) return { allocations: [], shortfall: 0 };
        if (!productId) throw new StockError('Product is required.');
        if (!godownId) throw new StockError('Godown is required to take stock out.');

        const lots = await InventoryStock.findAll({
            where: { productId, godownId, totalBaseUnits: { [Op.gt]: 0 } },
            order: [['createdAt', 'ASC'], ['id', 'ASC']],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        const available = lots.reduce((s, l) => s + Number(l.totalBaseUnits || 0), 0);
        const strict = !allowShortfall || (await isStrictFor(productId, godownId, t));
        if (available < qtyBase && strict) {
            const name = await productLabel(productId, t);
            throw new StockError(`Not enough stock for ${name}: needed ${qtyBase}, available ${available} (base units) in this godown.`, {
                productId, godownId, required: qtyBase, available,
            });
        }

        let remaining = qtyBase;
        let balance = available;
        const allocations = [];
        for (const lot of lots) {
            if (remaining <= 0) break;
            const have = Number(lot.totalBaseUnits || 0);
            const take = Math.min(have, remaining);
            await lot.update({ totalBaseUnits: have - take }, { transaction: t });
            balance -= take;
            const cost = lotCost(lot);
            const entry = await writeEntry(
                { lot, productId, variantId, godownId, movement, qtyChange: -take, unitCost: cost, ref, reason, note, actor, balanceAfter: balance, meta: allocations.length ? null : meta },
                t
            );
            allocations.push({ lot, entry, qty: take, unitCost: cost });
            remaining -= take;
        }
        if (remaining > 0) {
            logger.warn(`[Stock] Shortfall of ${remaining} base units for product ${productId} in godown ${godownId} (${ref?.refType || ''} ${ref?.refNo || ''})`);
        }
        await refreshHoldState(productId, t);
        return { allocations, shortfall: remaining };
    });

/**
 * Put back what a reference (order) took out: exactly the same qty into the same lots,
 * newest first. `qtyBase` limits how much (partial edit / return), `productId` limits which product.
 * Orders from before the stock ledger have no SALE entries; for those, `legacyItems`
 * ([{ productId, variantId, qtyBase, godownId }]) are restored once as new lots.
 */
export const reverseRef = async (opts, transaction) =>
    withTx(transaction, async (t) => {
        const { refType, refId, productId = null, movement = 'SALE_REVERSAL', note = null, actor = null, legacyItems = null, legacyMode = 'cancel', fallbackGodownId = null } = opts;
        let limit = opts.qtyBase !== undefined && opts.qtyBase !== null ? Math.round(Number(opts.qtyBase)) : null;
        if (limit !== null && limit <= 0) return { restored: 0 };
        if (!refType || !refId) throw new StockError('Reference is required to restore stock.');

        const where = { refType, refId: String(refId), movement: 'SALE' };
        if (productId) where.productId = productId;
        const entries = await InventoryTransaction.findAll({
            where,
            order: [['createdAt', 'DESC'], ['id', 'DESC']],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        const ref = opts.ref || { refType, refId, refNo: entries[0]?.refNo || opts.refNo || null };

        let restored = 0;
        const touched = new Set();
        const productsWithLedger = new Set(entries.map((e) => e.productId));

        for (const e of entries) {
            if (limit !== null && limit <= 0) break;
            const open = Math.abs(Number(e.qtyChange || 0)) - Number(e.reversedQty || 0);
            if (open <= 0) continue;
            const take = limit === null ? open : Math.min(open, limit);
            const cost = e.unitCost !== null && e.unitCost !== undefined ? Number(e.unitCost) : Number(e.avgPriceAfterTxn || 0);

            let lot = await InventoryStock.findByPk(e.stockId, { transaction: t, lock: t.LOCK.UPDATE });
            if (lot) {
                await lot.update({ totalBaseUnits: Number(lot.totalBaseUnits || 0) + take }, { transaction: t });
            } else {
                // original lot was closed at a cut-off: the goods come back as a new lot at the same cost
                const variant = await resolveVariant(e.productId, e.variantId, t);
                lot = await createLot({ productId: e.productId, godownId: e.godownId, variant, qtyBase: take, unitCost: cost, movement, ref }, t);
            }
            await e.update({ reversedQty: Number(e.reversedQty || 0) + take }, { transaction: t });
            const balanceAfter = await getProductBalance(e.productId, e.godownId, t);
            await writeEntry(
                { lot, productId: e.productId, variantId: e.variantId, godownId: e.godownId, movement, qtyChange: take, unitCost: cost, ref, note, actor, sourceEntryId: e.id, balanceAfter },
                t
            );
            restored += take;
            if (limit !== null) limit -= take;
            touched.add(e.productId);
        }

        // Orders from before the ledger: restore the order lines once (per product)
        if (Array.isArray(legacyItems) && legacyItems.length && (limit === null || limit > 0)) {
            for (const it of legacyItems) {
                if (!it?.productId || productsWithLedger.has(it.productId)) continue;
                if (productId && it.productId !== productId) continue;
                if (legacyMode === 'cancel') {
                    const already = await InventoryTransaction.count({
                        where: { refType, refId: String(refId), productId: it.productId, movement: 'SALE_REVERSAL', sourceEntryId: null },
                        transaction: t,
                    });
                    if (already) continue;
                }
                let qty = Math.round(Number(it.qtyBase || 0));
                if (limit !== null) qty = Math.min(qty, limit);
                const godownId = it.godownId || fallbackGodownId;
                if (qty <= 0 || !godownId) continue;
                await receive(
                    { productId: it.productId, godownId, variantId: it.variantId, qtyBase: qty, movement, ref, note: note || 'Stock restored (order from before the stock ledger)', actor, skipHoldRefresh: true },
                    t
                );
                restored += qty;
                if (limit !== null) limit -= qty;
                touched.add(it.productId);
            }
        }

        for (const pid of touched) await refreshHoldState(pid, t);
        return { restored };
    });

/**
 * Take stock out of ONE chosen lot (not FIFO), e.g. return a purchase at its own rate.
 * PURCHASE_RETURN reduces the Purchase column; ADJUSTMENT_OUT goes with the other corrections.
 * Returning a whole held purchase also cancels the new prices waiting on it.
 */
export const issueFromLot = async ({ lotId, qtyBase, movement = 'ADJUSTMENT_OUT', reason, note = null, actor = null }, transaction) =>
    withTx(transaction, async (t) => {
        const qty = Math.round(Number(qtyBase));
        if (!Number.isFinite(qty) || qty <= 0) throw new StockError('Enter a quantity to remove.');
        if (!reason || !String(reason).trim()) throw new StockError('Reason is required.');
        const lot = await InventoryStock.findByPk(lotId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!lot) throw new StockError('Lot not found.');
        const have = Number(lot.totalBaseUnits || 0);
        if (qty > have) throw new StockError(`This lot has only ${have} (base units) left.`);
        const left = have - qty;
        const cancelHeld = movement === 'PURCHASE_RETURN' && left === 0 && lot.pricingApplied === false;
        await lot.update({ totalBaseUnits: left, ...(cancelHeld ? { pricingApplied: true, pricingData: null } : {}) }, { transaction: t });
        const balanceAfter = await getProductBalance(lot.productId, lot.godownId, t);
        const entry = await writeEntry({
            lot, productId: lot.productId, variantId: lot.variantId, godownId: lot.godownId, movement, qtyChange: -qty, unitCost: lotCost(lot),
            ref: { refType: 'MANUAL', refNo: lot.sourceRef || (movement === 'PURCHASE_RETURN' ? 'RETURN' : 'ADJUSTMENT') },
            reason, note: cancelHeld ? `${note ? note + ' · ' : ''}held new prices cancelled` : note, actor, balanceAfter,
            meta: { lotId: lot.id, lotSource: lot.sourceType || null },
        }, t);
        await refreshHoldState(lot.productId, t);
        return { lot, entry, cancelHeld };
    });

/** Godown → godown. Cost travels with the stock. */
export const transfer = async (opts, transaction) =>
    withTx(transaction, async (t) => {
        const { productId, variantId = null, fromGodownId, toGodownId, ref = {}, note = null, actor = null } = opts;
        if (!fromGodownId || !toGodownId) throw new StockError('Both godowns are required for a transfer.');
        if (fromGodownId === toGodownId) throw new StockError('Source and destination godown cannot be the same.');
        const { allocations } = await issue(
            { productId, godownId: fromGodownId, variantId, qtyBase: opts.qtyBase, movement: 'TRANSFER_OUT', ref, note, actor, allowShortfall: false },
            t
        );
        for (const a of allocations) {
            await receive(
                {
                    productId, godownId: toGodownId, variantId: variantId || a.lot.variantId, qtyBase: a.qty, unitCost: a.unitCost, movement: 'TRANSFER_IN',
                    ref, note, actor, expiryDate: a.lot.expiryDate, batchNumber: a.lot.batchNumber, skipHoldRefresh: true,
                },
                t
            );
        }
        await refreshHoldState(productId, t);
        return { allocations };
    });

/** Manual correction with a reason (shortage, damage, excess …). */
export const adjust = async (opts, transaction) => {
    const { productId, godownId, variantId = null, direction, qtyBase, unitCost = null, reason, note = null, actor = null } = opts;
    if (!reason || !String(reason).trim()) throw new StockError('Reason is required for a stock adjustment.');
    const ref = { refType: 'MANUAL', refNo: 'ADJUSTMENT' };
    if (direction === 'IN') {
        return receive({ productId, godownId, variantId, qtyBase, unitCost, movement: 'ADJUSTMENT_IN', ref, reason, note, actor }, transaction);
    }
    if (direction === 'OUT') {
        return issue({ productId, godownId, variantId, qtyBase, movement: 'ADJUSTMENT_OUT', ref, reason, note, actor, allowShortfall: false }, transaction);
    }
    throw new StockError('Direction must be IN or OUT.');
};

/**
 * Damaged goods came back: recorded in the ledger, sellable stock does not change.
 * The qty is marked as returned on the original sale entries, so a later cancel does not bring it back.
 */
export const recordDamagedReturn = async ({ productId, variantId = null, godownId, qtyBase, ref = {}, note = null, actor = null }, transaction) =>
    withTx(transaction, async (t) => {
        if (ref?.refType && ref?.refId) {
            let left = Math.round(Number(qtyBase || 0));
            const sales = await InventoryTransaction.findAll({
                where: { refType: ref.refType, refId: String(ref.refId), movement: 'SALE', productId },
                order: [['createdAt', 'DESC'], ['id', 'DESC']],
                transaction: t,
                lock: t.LOCK.UPDATE,
            });
            for (const e of sales) {
                if (left <= 0) break;
                const open = Math.abs(Number(e.qtyChange || 0)) - Number(e.reversedQty || 0);
                if (open <= 0) continue;
                const take = Math.min(open, left);
                await e.update({ reversedQty: Number(e.reversedQty || 0) + take }, { transaction: t });
                left -= take;
            }
        }
        let lot = await InventoryStock.findOne({ where: { productId, godownId }, order: [['createdAt', 'DESC']], transaction: t, paranoid: false });
        if (!lot) {
            const variant = await resolveVariant(productId, variantId, t);
            if (!variant) return null;
            lot = await createLot({ productId, godownId, variant, qtyBase: 0, unitCost: defaultUnitCost(variant), movement: 'DAMAGED_RETURN', ref }, t);
        }
        const balanceAfter = await getProductBalance(productId, godownId, t);
        return writeEntry(
            { lot, productId, variantId, godownId, movement: 'DAMAGED_RETURN', qtyChange: 0, displayQty: Math.round(Number(qtyBase || 0)), unitCost: lotCost(lot), ref, note, actor, balanceAfter },
            t
        );
    });

/**
 * New purchase rate for the stock on hand: every lot of the product that is selling now
 * (not a held new purchase) takes the new cost. One ledger line per godown records it.
 */
export const revalueLots = async ({ productId, unitCost, actor = null, note = null }, transaction) =>
    withTx(transaction, async (t) => {
        const cost = Number(unitCost);
        if (!Number.isFinite(cost) || cost < 0) throw new StockError('Rate must be zero or more.');
        const lots = await InventoryStock.findAll({
            where: { productId, totalBaseUnits: { [Op.gt]: 0 }, pricingApplied: true },
            order: [['createdAt', 'ASC']],
            transaction: t,
            lock: t.LOCK.UPDATE,
        });
        const byGodown = new Map();
        for (const lot of lots) {
            const old = lotCost(lot);
            if (Math.abs(old - cost) < 0.00005) continue;
            const g = byGodown.get(lot.godownId) || { lot, units: 0, before: 0 };
            g.units += Number(lot.totalBaseUnits || 0);
            g.before += Number(lot.totalBaseUnits || 0) * old;
            byGodown.set(lot.godownId, g);
            await lot.update({ unitCost: round4(cost), avgPurchasePricePerBaseUnit: round2(cost) }, { transaction: t });
        }
        for (const [godownId, g] of byGodown) {
            const balanceAfter = await getProductBalance(productId, godownId, t);
            await writeEntry({
                lot: g.lot, productId, variantId: g.lot.variantId, godownId, movement: 'REVALUE', qtyChange: 0, displayQty: g.units, unitCost: cost,
                ref: { refType: 'MANUAL', refNo: 'RATE' },
                note: note || `Stock value ${round2(g.before)} → ${round2(g.units * cost)}`,
                actor, balanceAfter, meta: { units: g.units, valueBefore: round2(g.before), valueAfter: round2(g.units * cost) },
            }, t);
        }
        return { godowns: byGodown.size };
    });

/* ───────────────────────────── Cut-off (Opening) ───────────────────────────── */

/**
 * Post a cut-off: close every old lot (ledger entry + archive), switch off old holds,
 * and create one OPENING lot per counted product + godown. Runs in one transaction.
 */
export const postCutoff = async ({ cutoffId, actor = null }) =>
    sequelize.transaction(async (t) => {
        const cutoff = await StockCutoff.findByPk(cutoffId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!cutoff) throw new StockError('Cut-off not found.');
        if (cutoff.status !== 'DRAFT') throw new StockError('Only a draft cut-off can be posted.');

        const ref = { refType: 'OPENING', refId: cutoff.id, refNo: 'CUT-OFF' };
        const who = actorInfo(actor);

        // 1. Close all old lots
        const lots = await InventoryStock.findAll({ transaction: t, lock: t.LOCK.UPDATE, order: [['createdAt', 'ASC']] });
        const running = new Map();
        for (const lot of lots) {
            const key = `${lot.productId}|${lot.godownId}`;
            running.set(key, (running.get(key) || 0) + Number(lot.totalBaseUnits || 0));
        }
        const archiveEntries = [];
        let archivedUnits = 0;
        let archivedValue = 0;
        for (const lot of lots) {
            const qty = Number(lot.totalBaseUnits || 0);
            if (!qty) continue;
            const key = `${lot.productId}|${lot.godownId}`;
            const balance = (running.get(key) || 0) - qty;
            running.set(key, balance);
            const cost = lotCost(lot);
            const spp = Number(lot.secondaryPerPrimary) > 0 ? Number(lot.secondaryPerPrimary) : 1;
            archiveEntries.push({
                stockId: lot.id,
                productId: lot.productId,
                variantId: lot.variantId,
                godownId: lot.godownId,
                type: 'ADJUSTMENT',
                movement: 'CUTOFF_ARCHIVE',
                primaryUnitId: lot.primaryUnitId || ZERO_UUID,
                secondaryUnitId: lot.secondaryUnitId || null,
                secondaryPerPrimary: spp,
                qtyPrimary: Math.floor(Math.abs(qty) / spp),
                qtySecondary: Math.abs(qty) % spp,
                totalQtyBaseUnits: -qty,
                qtyChange: -qty,
                unitCost: round4(cost),
                avgPriceAfterTxn: round2(cost),
                balanceAfterBaseUnits: Math.round(balance),
                refType: ref.refType,
                refId: String(ref.refId),
                refNo: ref.refNo,
                note: 'Old stock closed at cut-off',
                createdBy: who.name,
                createdById: who.id,
            });
            archivedUnits += qty;
            archivedValue += qty * cost;
        }
        if (archiveEntries.length) await InventoryTransaction.bulkCreate(archiveEntries, { transaction: t });
        const lotIds = lots.map((l) => l.id);
        if (lotIds.length) {
            await InventoryStock.update({ totalBaseUnits: 0, status: 'Archived', pricingApplied: true }, { where: { id: lotIds }, transaction: t });
            await InventoryStock.destroy({ where: { id: lotIds }, transaction: t });
        }

        // 2. Old purchase-bill holds end here (prices stay as they are now)
        const [holdsCleared] = await ProductVariant.update(
            { oldStockLockToggle: false, oldStockLimitQty: 0, newPricingData: null },
            { where: { oldStockLockToggle: true }, transaction: t }
        );

        // 3. Opening lots from the physical count
        const counts = await StockOpeningCount.findAll({ where: { cutoffId: cutoff.id }, transaction: t });
        let countedRows = 0;
        let openingUnits = 0;
        let openingValue = 0;
        const products = new Set();
        for (const c of counts) {
            const qty = Math.round(Number(c.qtyBase || 0));
            if (qty <= 0) continue;
            await receive(
                {
                    productId: c.productId, godownId: c.godownId, qtyBase: qty, unitCost: Number(c.unitCost || 0), movement: 'OPENING',
                    ref: { refType: 'OPENING', refId: cutoff.id, refNo: 'OPENING' }, note: 'Opening stock (physical count)', actor, skipHoldRefresh: true,
                },
                t
            );
            countedRows += 1;
            products.add(c.productId);
            openingUnits += qty;
            openingValue += qty * Number(c.unitCost || 0);
        }

        const now = new Date();
        await cutoff.update(
            {
                status: 'POSTED',
                postedAt: now,
                cutoffAt: now,
                postedBy: who.name,
                summary: {
                    archivedLots: lotIds.length,
                    archivedUnits,
                    archivedValue: round2(archivedValue),
                    holdsCleared,
                    openingRows: countedRows,
                    openingProducts: products.size,
                    openingUnits,
                    openingValue: round2(openingValue),
                },
            },
            { transaction: t }
        );
        return cutoff;
    });

export const assertGodown = async (godownId, t) => {
    const godown = godownId ? await Godown.findByPk(godownId, { transaction: t }) : null;
    if (!godown) throw new StockError('Godown not found.');
    return godown;
};

export default {
    receive,
    issue,
    reverseRef,
    transfer,
    adjust,
    issueFromLot,
    recordDamagedReturn,
    refreshHoldState,
    applyPricingSet,
    postCutoff,
    toBaseUnits,
    perPackOf,
    getProductBalance,
    getDisplayVariant,
    isStrictMode,
    isStrictFor,
    revalueLots,
    getPostedCutoff,
    getDraftCutoff,
    StockError,
};
