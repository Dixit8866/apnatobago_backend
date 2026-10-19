import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backendRoot = join(__dirname, '..');
const envPath = join(backendRoot, '.env');
const envProdPath = join(backendRoot, '.env.production');

// 1. Load correct environment configuration
if (process.env.NODE_ENV === 'production' && fs.existsSync(envProdPath)) {
    dotenv.config({ path: envProdPath });
} else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else if (fs.existsSync(envProdPath)) {
    dotenv.config({ path: envProdPath });
} else {
    dotenv.config();
}

// 2. Import database and models
const { default: sequelize } = await import('../config/db.js');
const {
    Order,
    OrderItem,
    OrderAssignment,
    User,
    BusinessProfile,
    Godown,
    RouteCategory,
    DeliveryBoy,
    Product,
    ProductVariant,
    ActivityLog
} = await import('../models/index.js');
import { Op } from 'sequelize';

/**
 * =========================================================================================
 * TODAY'S PACKAGING / PACKED ORDERS REPORT (READ-ONLY)
 * =========================================================================================
 *
 * Lists every order that belongs to "today" (IST) in the Packaging / Packed stage and logs
 * complete details (party, route, godown, delivery boy, amounts, items, status history).
 *
 * An order is picked up if ANY of these match (each order shows which rule matched it):
 *   [CURRENT]  orderStatus is Packaging/Packed AND it is today's order — same rule as the
 *              admin Order List tab: deliveryDate = today, or (deliveryDate empty AND created today)
 *   [STAMPED]  packagingAt or packedAt timestamp falls inside today — catches orders that
 *              went to Packaging/Packed today but whose status has changed since
 *   [ACTIVITY] an activity log entry today moved the order into / out of Packaging/Packed
 *
 * Soft-deleted orders are included too and flagged as DELETED.
 *
 * 🛡️ This script only READS. Nothing is updated or deleted.
 *
 * Output:
 *   - Full report printed on the console
 *   - Same report saved to  logs/packaging-packed-orders-<date>.log
 *   - With --json, raw data also saved to  logs/packaging-packed-orders-<date>.json
 *
 * Usage Examples:
 *   # 1. Today's Packaging + Packed orders (local)
 *   node scripts/list-today-packaging-packed-orders.js
 *
 *   # 2. Production database
 *   NODE_ENV=production node scripts/list-today-packaging-packed-orders.js
 *
 *   # 3. Specific date (IST)
 *   node scripts/list-today-packaging-packed-orders.js --date=2026-10-19
 *
 *   # 4. Only one status
 *   node scripts/list-today-packaging-packed-orders.js --status=Packaging
 *
 *   # 5. Only orders that are STILL in Packaging/Packed right now (skip STAMPED/ACTIVITY rules)
 *   node scripts/list-today-packaging-packed-orders.js --current-only
 *
 *   # 6. Every order currently in Packaging/Packed, whatever its date
 *   node scripts/list-today-packaging-packed-orders.js --all-dates
 *
 *   # 7. Also save raw JSON
 *   node scripts/list-today-packaging-packed-orders.js --json
 * =========================================================================================
 */

// ─── CLI args ────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const todayIST = () => {
    const ist = new Date(Date.now() + IST_OFFSET_MS);
    return ist.toISOString().slice(0, 10);
};

const targetDate = getArg('date') || todayIST();
if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error(`❌ Invalid --date "${targetDate}". Use YYYY-MM-DD.`);
    process.exit(1);
}

const statuses = (getArg('status') || 'Packaging,Packed')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const currentOnly = hasFlag('current-only');
const allDates = hasFlag('all-dates');
const saveJson = hasFlag('json');

const startOfDay = new Date(`${targetDate}T00:00:00.000+05:30`);
const endOfDay = new Date(`${targetDate}T23:59:59.999+05:30`);

// ─── Output (console + log file) ─────────────────────────────────────────────────────────
const logsDir = join(backendRoot, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const fileSuffix = allDates ? 'all-dates' : targetDate;
const logFilePath = join(logsDir, `packaging-packed-orders-${fileSuffix}.log`);
const jsonFilePath = join(logsDir, `packaging-packed-orders-${fileSuffix}.json`);
const lines = [];

const log = (msg = '') => {
    console.log(msg);
    lines.push(msg);
};

// ─── Formatting helpers ──────────────────────────────────────────────────────────────────
const num = (v) => Number(v || 0);
const money = (v) => `₹${num(v).toFixed(2)}`;

const fmtIST = (d) => {
    if (!d) return '-';
    const ist = new Date(new Date(d).getTime() + IST_OFFSET_MS);
    return `${ist.toISOString().slice(0, 19).replace('T', ' ')} IST`;
};

const pickName = (name) => {
    if (!name) return '';
    if (typeof name === 'string') return name;
    return name.en || name.English || Object.values(name)[0] || '';
};

const fmtAddress = (addr) => {
    if (!addr) return '-';
    if (typeof addr === 'string') return addr;
    return Object.entries(addr)
        .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ') || '-';
};

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const padL = (s, n) => String(s ?? '').padStart(n).slice(-n);

// ─── Main ────────────────────────────────────────────────────────────────────────────────
const run = async () => {
    await sequelize.authenticate();

    log('='.repeat(100));
    log(`  PACKAGING / PACKED ORDERS REPORT`);
    log('='.repeat(100));
    log(`  Environment : ${process.env.NODE_ENV || 'development'}  (DB: ${process.env.DB_NAME}@${process.env.DB_HOST})`);
    log(`  Date (IST)  : ${allDates ? 'ALL DATES' : targetDate}`);
    log(`  Statuses    : ${statuses.join(', ')}`);
    log(`  Mode        : ${currentOnly || allDates ? 'Current status only' : 'Current status + reached today (timestamps / activity log)'}`);
    log(`  Generated   : ${fmtIST(new Date())}`);
    log('='.repeat(100));

    // reasons: Map<orderUuid, Set<'CURRENT'|'STAMPED'|'ACTIVITY'>>
    const reasons = new Map();
    const addReason = (id, reason) => {
        if (!reasons.has(id)) reasons.set(id, new Set());
        reasons.get(id).add(reason);
    };

    // Rule 1: CURRENT — status is Packaging/Packed and it is today's order (admin tab logic)
    const currentWhere = { orderStatus: { [Op.in]: statuses } };
    if (!allDates) {
        currentWhere[Op.or] = [
            { deliveryDate: targetDate },
            { deliveryDate: null, createdAt: { [Op.between]: [startOfDay, endOfDay] } }
        ];
    }
    const currentRows = await Order.findAll({ where: currentWhere, attributes: ['id'], paranoid: false });
    currentRows.forEach(o => addReason(o.id, 'CURRENT'));

    if (!currentOnly && !allDates) {
        // Rule 2: STAMPED — packagingAt / packedAt set today
        const stampOr = [];
        if (statuses.includes('Packaging')) stampOr.push({ packagingAt: { [Op.between]: [startOfDay, endOfDay] } });
        if (statuses.includes('Packed')) stampOr.push({ packedAt: { [Op.between]: [startOfDay, endOfDay] } });
        if (stampOr.length) {
            const stampedRows = await Order.findAll({ where: { [Op.or]: stampOr }, attributes: ['id'], paranoid: false });
            stampedRows.forEach(o => addReason(o.id, 'STAMPED'));
        }

        // Rule 3: ACTIVITY — status change logged today into / out of the selected statuses
        const activityRows = await ActivityLog.findAll({
            where: {
                createdAt: { [Op.between]: [startOfDay, endOfDay] },
                [Op.or]: [
                    sequelize.where(sequelize.literal(`"metadata"->>'newStatus'`), { [Op.in]: statuses }),
                    sequelize.where(sequelize.literal(`"metadata"->>'prevStatus'`), { [Op.in]: statuses })
                ]
            },
            attributes: ['metadata']
        });
        activityRows.forEach(a => {
            const oid = a.metadata?.orderId;
            if (oid && /^[0-9a-f-]{36}$/i.test(oid)) addReason(oid, 'ACTIVITY');
        });
    }

    const orderIds = [...reasons.keys()];

    if (!orderIds.length) {
        log('');
        log(`  ⚠️  No ${statuses.join('/')} orders found for ${allDates ? 'any date' : targetDate}.`);
        await reportStale();
        finish([]);
        return;
    }

    // Full details
    const orders = await Order.findAll({
        where: { id: { [Op.in]: orderIds } },
        paranoid: false,
        include: [
            {
                model: User,
                as: 'user',
                attributes: ['id', 'fullname', 'number', 'city', 'closingBalance'],
                include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress', 'city', 'area', 'gstNumber'] }]
            },
            { model: RouteCategory, as: 'routeCategory', attributes: ['id', 'name'] },
            { model: Godown, as: 'godown', attributes: ['id', 'name'] },
            {
                model: OrderAssignment,
                as: 'assignment',
                attributes: ['status', 'assignedAt', 'notes'],
                include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['name', 'phone'] }]
            },
            {
                model: OrderItem,
                as: 'items',
                include: [
                    { model: Product, as: 'product', attributes: ['name'] },
                    { model: ProductVariant, as: 'variant', attributes: ['volume'] }
                ]
            }
        ],
        order: [['createdAt', 'ASC'], [{ model: OrderItem, as: 'items' }, 'createdAt', 'ASC']]
    });

    // Activity history for these orders on the target date
    const historyByOrder = new Map();
    if (!allDates) {
        const history = await ActivityLog.findAll({
            where: {
                createdAt: { [Op.between]: [startOfDay, endOfDay] },
                [Op.and]: [sequelize.where(sequelize.literal(`"metadata"->>'orderId'`), { [Op.in]: orderIds })]
            },
            attributes: ['action', 'description', 'userName', 'userType', 'metadata', 'createdAt'],
            order: [['createdAt', 'ASC']]
        });
        history.forEach(h => {
            const oid = h.metadata.orderId;
            if (!historyByOrder.has(oid)) historyByOrder.set(oid, []);
            historyByOrder.get(oid).push(h);
        });
    }

    // Product-wise totals (only for orders still in the selected statuses and not deleted)
    const productTotals = new Map();
    const summary = {
        byStatus: {},
        byRoute: {},
        byGodown: {},
        stillInStage: 0,
        movedOut: 0,
        deleted: 0,
        totalAmount: 0,
        totalItems: 0
    };

    const jsonOut = [];

    orders.forEach((o, idx) => {
        const r = [...(reasons.get(o.id) || [])];
        const isDeleted = !!o.deletedAt;
        const inStage = statuses.includes(o.orderStatus);

        const partyName = o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName || '-';
        const ownerName = o.user?.fullname || o.customerName || '-';
        const phone = o.user?.number || o.customerNumber || '-';
        const routeName = o.routeCategory?.name || '-';
        const godownName = o.godown?.name || '-';

        summary.byStatus[o.orderStatus] = (summary.byStatus[o.orderStatus] || 0) + 1;
        summary.byRoute[routeName] = (summary.byRoute[routeName] || 0) + 1;
        summary.byGodown[godownName] = (summary.byGodown[godownName] || 0) + 1;
        if (isDeleted) summary.deleted++;
        if (inStage && !isDeleted) summary.stillInStage++;
        if (!inStage) summary.movedOut++;
        summary.totalAmount += num(o.totalAmount);
        summary.totalItems += o.items.length;

        log('');
        log('-'.repeat(100));
        log(`  #${idx + 1}  ORDER ${o.orderId}   [${o.orderStatus}]${isDeleted ? '   ❗ DELETED' : ''}${!inStage ? `   ⚠️ NOW "${o.orderStatus}"` : ''}`);
        log(`      Matched by      : ${r.join(', ')}`);
        log('-'.repeat(100));
        log(`  Order UUID        : ${o.id}`);
        log(`  Party / Shop      : ${partyName}`);
        log(`  Owner             : ${ownerName}`);
        log(`  Phone             : ${phone}`);
        log(`  City / Area       : ${o.user?.businessProfile?.city || o.user?.city || '-'} / ${o.user?.businessProfile?.area || '-'}`);
        log(`  User ID           : ${o.userId || '-'}`);
        log(`  Sale Type         : ${o.saleType}    Delivery Mode: ${o.deliveryMode || '-'}    Round: ${o.deliveryRoundTiming || '-'} (${o.deliveryRoundId || '-'})`);
        log(`  Route             : ${routeName}`);
        log(`  Godown            : ${godownName}`);
        log(`  Delivery Boy      : ${o.assignment?.deliveryBoy ? `${o.assignment.deliveryBoy.name} (${o.assignment.deliveryBoy.phone || '-'}) — ${o.assignment.status || '-'}` : 'Not assigned'}`);
        log(`  Shipping Address  : ${fmtAddress(o.shippingAddress)}`);
        log('');
        log(`  Order Date        : ${o.orderDate || '-'}        Delivery Date: ${o.deliveryDate || '-'}`);
        log(`  Created At        : ${fmtIST(o.createdAt)}`);
        log(`  Packaging At      : ${fmtIST(o.packagingAt)}`);
        log(`  Packed At         : ${fmtIST(o.packedAt)}`);
        log(`  Shipping At       : ${fmtIST(o.shippingAt)}`);
        log(`  Delivered At      : ${fmtIST(o.deliveredAt)}`);
        log(`  Updated At        : ${fmtIST(o.updatedAt)}`);
        if (isDeleted) log(`  Deleted At        : ${fmtIST(o.deletedAt)}`);
        log('');
        log(`  Payment Method    : ${o.paymentMethod}    Payment Status: ${o.paymentStatus}    Collect Status: ${o.paymentCollectStatus}`);
        log(`  Total Amount      : ${money(o.totalAmount)}    Paid: ${money(o.paidAmount)}    Due: ${money(o.dueAmount)}`);
        log(`  Discount          : ${money(o.discount)}${o.discountType ? ` (${o.discountType})` : ''}    Coupon: ${money(o.couponDiscount)} (${o.couponPoints || 0} pts)    Delivery Charge: ${money(o.deliveryCharge)}`);
        if (num(o.pastDueCollected)) log(`  Past Due Collected: ${money(o.pastDueCollected)}`);
        if (o.isMerged) log(`  Merged Order      : Yes`);
        if (o.notes) log(`  Notes             : ${o.notes}`);
        if (o.deliveryNotice) log(`  Delivery Notice   : ${o.deliveryNotice}`);

        log('');
        log(`  ITEMS (${o.items.length})`);
        log(`  ${pad('No', 4)}${pad('Product', 40)}${pad('Variant', 16)}${padL('Qty', 8)} ${pad('Unit', 6)}${padL('Price', 11)}${padL('Disc', 10)}${padL('Line Total', 13)}`);
        let itemsTotal = 0;
        o.items.forEach((it, i) => {
            const productName = pickName(it.product?.name) || it.variantInfo?.productName && pickName(it.variantInfo.productName) || '-';
            const variant = it.variant?.volume || it.variantInfo?.volume || '-';
            const extra = it.variantInfo?.extra ? ` ${it.variantInfo.extra}` : '';
            const lineTotal = num(it.price) * num(it.quantity) - num(it.discount);
            itemsTotal += lineTotal;
            log(`  ${pad(i + 1, 4)}${pad(productName, 40)}${pad(variant + extra, 16)}${padL(num(it.quantity), 8)} ${pad(it.sellUnit, 6)}${padL(num(it.price).toFixed(2), 11)}${padL(num(it.discount).toFixed(2), 10)}${padL(lineTotal.toFixed(2), 13)}`);

            if (inStage && !isDeleted) {
                const key = `${it.productId}|${it.variantId}|${it.sellUnit}`;
                const prev = productTotals.get(key) || { productName, variant: variant + extra, sellUnit: it.sellUnit, qty: 0, orders: 0 };
                prev.qty += num(it.quantity);
                prev.orders += 1;
                productTotals.set(key, prev);
            }
        });
        log(`  ${' '.repeat(95)}${padL(itemsTotal.toFixed(2), 13)}`);

        const hist = historyByOrder.get(o.id) || [];
        if (hist.length) {
            log('');
            log(`  ACTIVITY ON ${targetDate}`);
            hist.forEach(h => {
                const m = h.metadata || {};
                const change = m.prevStatus || m.newStatus ? `  [${m.prevStatus || '?'} → ${m.newStatus || '?'}]` : '';
                log(`    ${fmtIST(h.createdAt)}  ${h.action}${change}  by ${h.userName || '-'} (${h.userType || '-'})  — ${h.description}`);
            });
        }

        jsonOut.push({
            matchedBy: r,
            isDeleted,
            stillInStage: inStage,
            ...o.toJSON(),
            activity: hist.map(h => h.toJSON())
        });
    });

    // ─── Summary ─────────────────────────────────────────────────────────────────────────
    log('');
    log('='.repeat(100));
    log('  SUMMARY');
    log('='.repeat(100));
    log(`  Total orders found              : ${orders.length}`);
    log(`  Still in ${statuses.join('/')} (not deleted) : ${summary.stillInStage}`);
    log(`  Moved to another status         : ${summary.movedOut}`);
    log(`  Deleted (soft)                  : ${summary.deleted}`);
    log(`  Total order value               : ${money(summary.totalAmount)}`);
    log(`  Total item lines                : ${summary.totalItems}`);
    log('');
    log('  By current status:');
    Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));
    log('');
    log('  By route:');
    Object.entries(summary.byRoute).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));
    log('');
    log('  By godown:');
    Object.entries(summary.byGodown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));

    if (productTotals.size) {
        log('');
        log(`  PRODUCT-WISE QTY (orders still in ${statuses.join('/')})`);
        log(`  ${pad('Product', 44)}${pad('Variant', 18)}${pad('Unit', 8)}${padL('Qty', 10)}${padL('Orders', 8)}`);
        [...productTotals.values()]
            .sort((a, b) => a.productName.localeCompare(b.productName))
            .forEach(p => log(`  ${pad(p.productName, 44)}${pad(p.variant, 18)}${pad(p.sellUnit, 8)}${padL(p.qty, 10)}${padL(p.orders, 8)}`));
    }

    log('');
    log('  ORDER NUMBERS');
    log(`  ${orders.map(o => o.orderId).join(', ')}`);

    await reportStale();
    finish(jsonOut);
};

// Orders still sitting in Packaging/Packed from OTHER dates — these don't show in the admin "today" tabs
const reportStale = async () => {
    if (allDates) return;
    const inStageNow = await Order.findAll({
        where: { orderStatus: { [Op.in]: statuses } },
        attributes: ['orderId', 'orderStatus', 'deliveryDate', 'createdAt'],
        order: [['createdAt', 'ASC']]
    });
    const isTodays = (o) => o.deliveryDate
        ? o.deliveryDate === targetDate
        : (o.createdAt >= startOfDay && o.createdAt <= endOfDay);
    const stale = inStageNow.filter(o => !isTodays(o));
    if (!stale.length) return;

    log('');
    log(`  ⚠️  ${stale.length} order(s) are in ${statuses.join('/')} with a DIFFERENT date (hidden from today's admin tab):`);
    stale.forEach(s => log(`    ${pad(s.orderId, 20)} ${pad(s.orderStatus, 12)} deliveryDate: ${pad(s.deliveryDate || '-', 12)} created: ${fmtIST(s.createdAt)}`));
    log(`  Run with --all-dates to see their full details.`);
};

const finish = (jsonOut) => {
    log('');
    log('='.repeat(100));
    fs.writeFileSync(logFilePath, lines.join('\n') + '\n', 'utf8');
    console.log(`📄 Report saved to: ${logFilePath}`);
    if (saveJson) {
        fs.writeFileSync(jsonFilePath, JSON.stringify(jsonOut, null, 2), 'utf8');
        console.log(`🧾 JSON saved to:   ${jsonFilePath}`);
    }
};

// models/index.js fires non-blocking schema migrations on import; closing the pool here would make
// them spam "connection manager was closed" warnings, so just exit once the report is written.
try {
    await run();
    process.exit(0);
} catch (err) {
    console.error('❌ Script failed:', err);
    process.exit(1);
}
