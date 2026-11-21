import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import logger from '../logger/apiLogger.js';
import stockService, { toBaseUnits } from '../services/stock.service.js';

const models = () => sequelize.models;

/**
 * Order lines → stock lines in base units. Combo products are split into their two
 * component products (same rule the order screens used before).
 * @returns [{ productId, variantId, qtyBase, label }]
 */
export const buildStockLines = async (items = [], t = null) => {
    const { ProductVariant, Product } = models();
    const lines = [];
    for (const item of items) {
        if (!item?.variantId) continue;
        const variant = await ProductVariant.findByPk(item.variantId, {
            include: [{ model: Product, as: 'product' }],
            transaction: t,
            paranoid: false,
        });
        if (!variant) continue;
        const sellUnit = item.sellUnit || 'Base';

        if (variant.product?.isCombo) {
            for (const cpId of [variant.product.comboProduct1Id, variant.product.comboProduct2Id].filter(Boolean)) {
                const compVariant = (await ProductVariant.findOne({
                    where: { productId: cpId, ...(variant.volumeId ? { volumeId: variant.volumeId } : {}) },
                    transaction: t,
                })) || (await ProductVariant.findOne({ where: { productId: cpId }, transaction: t }));
                if (!compVariant) continue;
                const qtyBase = toBaseUnits(item.quantity, sellUnit, compVariant);
                if (qtyBase > 0) lines.push({ productId: cpId, variantId: compVariant.id, qtyBase, combo: true });
            }
        } else {
            const qtyBase = toBaseUnits(item.quantity, sellUnit, variant);
            if (qtyBase > 0) lines.push({ productId: variant.productId, variantId: variant.id, qtyBase, combo: false });
        }
    }
    return lines;
};

/** Godown an order's stock belongs to: order → assignment → its sale entries → main godown. */
export const resolveOrderGodownId = async (order, t = null) => {
    const { OrderAssignment, InventoryTransaction, Godown } = models();
    if (order?.godownId) return order.godownId;
    if (OrderAssignment && order?.id) {
        const assignment = await OrderAssignment.findOne({ where: { orderId: order.id }, transaction: t });
        if (assignment?.godownId) return assignment.godownId;
    }
    if (order?.id) {
        const sale = await InventoryTransaction.findOne({ where: { refType: 'ORDER', refId: String(order.id), movement: 'SALE' }, transaction: t });
        if (sale?.godownId) return sale.godownId;
    }
    const main = (await Godown.findOne({ where: { type: 'main', status: 'Active' }, order: [['createdAt', 'ASC']], transaction: t }))
        || (await Godown.findOne({ where: { status: 'Active' }, order: [['createdAt', 'ASC']], transaction: t }));
    return main?.id || null;
};

/** Take an order's stock out (FIFO, one godown). */
export const issueOrderStock = async ({ refType = 'ORDER', refId, refNo, godownId, items, actor, note }, t) => {
    const lines = await buildStockLines(items, t);
    for (const line of lines) {
        await stockService.issue(
            {
                productId: line.productId,
                godownId,
                variantId: line.variantId,
                qtyBase: line.qtyBase,
                movement: 'SALE',
                ref: { refType, refId, refNo },
                note: note || `${refType === 'OUTLET_ORDER' ? 'Outlet Order' : 'Order'} #${refNo}${line.combo ? ' (combo part)' : ''}`,
                actor,
            },
            t
        );
    }
    return lines;
};

/**
 * One order line changed (admin edit / add / delete): take out or put back only the difference,
 * per product, in the order's godown. `oldLine` / `newLine` = { variantId, quantity, sellUnit } or null.
 */
export const syncOrderLineStock = async ({ order, oldLine = null, newLine = null, actor, refType = 'ORDER' }, t) => {
    const godownId = refType === 'OUTLET_ORDER' ? order.godownId : await resolveOrderGodownId(order, t);
    const oldStock = oldLine ? await buildStockLines([oldLine], t) : [];
    const newStock = newLine ? await buildStockLines([newLine], t) : [];
    const net = new Map();
    for (const l of oldStock) {
        const cur = net.get(l.productId) || { variantId: l.variantId, diff: 0 };
        net.set(l.productId, { variantId: cur.variantId, diff: cur.diff - l.qtyBase });
    }
    for (const l of newStock) {
        const cur = net.get(l.productId) || { variantId: l.variantId, diff: 0 };
        net.set(l.productId, { variantId: l.variantId, diff: cur.diff + l.qtyBase });
    }
    const ref = { refType, refId: order.id, refNo: order.orderId };
    for (const [productId, { variantId, diff }] of net) {
        if (diff > 0) {
            await stockService.issue(
                { productId, godownId, variantId, qtyBase: diff, movement: 'SALE', ref, note: `Order #${order.orderId} edited (+)`, actor },
                t
            );
        } else if (diff < 0) {
            await stockService.reverseRef(
                {
                    refType, refId: order.id, ref, productId, qtyBase: -diff, movement: 'SALE_REVERSAL', note: `Order #${order.orderId} edited (−)`, actor,
                    legacyItems: [{ productId, variantId, qtyBase: -diff, godownId }], legacyMode: 'return', fallbackGodownId: godownId,
                },
                t
            );
        }
    }
};

/**
 * Sales return of one product line. GOOD goes back into the lots the sale used (same cost);
 * DAMAGED is only written in the ledger, sellable stock does not change.
 */
export const returnOrderStock = async ({ order, productId, variantId, qtyBase, condition = 'GOOD', actor, note }, t) => {
    const qty = Math.round(Number(qtyBase || 0));
    if (qty <= 0) return { restored: 0 };
    const godownId = await resolveOrderGodownId(order, t);
    const ref = { refType: 'ORDER', refId: order.id, refNo: order.orderId };
    if (String(condition).toUpperCase() === 'DAMAGED') {
        await stockService.recordDamagedReturn({ productId, variantId, godownId, qtyBase: qty, ref, note: note || `Damaged return for Order #${order.orderId}`, actor }, t);
        return { restored: 0 };
    }
    return stockService.reverseRef(
        {
            refType: 'ORDER', refId: order.id, ref, productId, qtyBase: qty, movement: 'SALES_RETURN', note: note || `Sales return for Order #${order.orderId}`, actor,
            legacyItems: [{ productId, variantId, qtyBase: qty, godownId }], legacyMode: 'return', fallbackGodownId: godownId,
        },
        t
    );
};

/** Did the old code (before the ledger) already put this order's stock back on cancel / delete? */
const hasLegacyCancelRestore = async (kind, orderNo, t) => {
    if (!orderNo) return false;
    const { InventoryTransaction } = models();
    const no = String(orderNo).replace(/[^0-9A-Za-z-]/g, '');
    const patterns = kind === 'OUTLET_ORDER'
        ? [`^Cancelled Outlet Order #${no}( |$)`, `^Deleted Outlet Order #${no}( |$)`]
        : [`^Stock Restored \\(Cancelled Order #${no}\\)`];
    const count = await InventoryTransaction.count({
        where: {
            movement: null,
            [Op.or]: patterns.map((p) => sequelize.where(sequelize.col('note'), { [Op.regexp]: p })),
        },
        transaction: t,
    });
    return count > 0;
};

/**
 * Put back all stock an order took (cancel / delete). Uses the ledger; orders from
 * before the ledger fall back to their current lines, once.
 */
export const restoreOrderStock = async (orderId, actorName = 'System', transactionObj = null) => {
    const { Order, OrderItem } = models();
    const run = async (t) => {
        const order = await Order.findByPk(orderId, { include: [{ model: OrderItem, as: 'items' }], transaction: t });
        if (!order) return { restored: 0 };
        const godownId = await resolveOrderGodownId(order, t);
        const legacyItems = (await hasLegacyCancelRestore('ORDER', order.orderId, t))
            ? null
            : (await buildStockLines(order.items || [], t)).map((l) => ({ ...l, godownId }));
        const result = await stockService.reverseRef(
            {
                refType: 'ORDER',
                refId: order.id,
                ref: { refType: 'ORDER', refId: order.id, refNo: order.orderId },
                movement: 'SALE_REVERSAL',
                note: `Stock restored (Cancelled Order #${order.orderId || order.id})`,
                actor: actorName,
                legacyItems,
                legacyMode: 'cancel',
                fallbackGodownId: godownId,
            },
            t
        );
        logger.info(`[Order Cancel Stock Restored]: order=${order.orderId} restored=${result.restored} base units`);
        return result;
    };
    try {
        return transactionObj ? await run(transactionObj) : await sequelize.transaction(run);
    } catch (err) {
        logger.error(`[Restore Order Stock Error]: ${err.message}`);
        if (transactionObj) throw err;
        return { restored: 0, error: err.message };
    }
};

/** Same for an outlet order. */
export const restoreOutletOrderStock = async (order, actor, t, note) => {
    const { OutletOrderItem } = models();
    const items = await OutletOrderItem.findAll({ where: { outletOrderId: order.id }, transaction: t });
    const legacyItems = (await hasLegacyCancelRestore('OUTLET_ORDER', order.orderId, t))
        ? null
        : (await buildStockLines(items, t)).map((l) => ({ ...l, godownId: order.godownId }));
    return stockService.reverseRef(
        {
            refType: 'OUTLET_ORDER',
            refId: order.id,
            ref: { refType: 'OUTLET_ORDER', refId: order.id, refNo: order.orderId },
            movement: 'SALE_REVERSAL',
            note: note || `Stock restored (Outlet Order #${order.orderId})`,
            actor,
            legacyItems,
            legacyMode: 'cancel',
            fallbackGodownId: order.godownId,
        },
        t
    );
};

export { Op };
