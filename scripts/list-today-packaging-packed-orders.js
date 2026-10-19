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
 * Lists every order whose status in the database is RIGHT NOW "Packaging" or "Packed"
 * (the admin panel no longer has tabs for these statuses, so such orders are invisible there)
 * and logs complete details (party, route, godown, delivery boy, amounts, items, history).
 *
 * Deleted / merged orders and orders already moved to Shipping etc. are NOT listed.
 *
 * An order counts as "today's" when ANY of these fall on the target date (IST):
 *   deliveryDate, createdAt, packagingAt, packedAt
 * Orders still in Packaging/Packed from older dates are listed in a short section at the end.
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
 *   # 5. Every order currently in Packaging/Packed, whatever its date
 *   node scripts/list-today-packaging-packed-orders.js --all-dates
 *
 *   # 6. Also save raw JSON
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

const inDay = (d) => !!d && new Date(d) >= startOfDay && new Date(d) <= endOfDay;

// Which fields make this order "today's"
const todayReasons = (o) => [
    o.deliveryDate === targetDate && 'Delivery date',
    inDay(o.createdAt) && 'Created',
    inDay(o.packagingAt) && 'Packaging at',
    inDay(o.packedAt) && 'Packed at'
].filter(Boolean);

// ─── Main ────────────────────────────────────────────────────────────────────────────────
const run = async () => {
    await sequelize.authenticate();

    log('='.repeat(100));
    log(`  PACKAGING / PACKED ORDERS REPORT  (current status in database)`);
    log('='.repeat(100));
    log(`  Environment : ${process.env.NODE_ENV || 'development'}  (DB: ${process.env.DB_NAME}@${process.env.DB_HOST})`);
    log(`  Date (IST)  : ${allDates ? 'ALL DATES' : `${targetDate}  (deliveryDate / createdAt / packagingAt / packedAt on this date)`}`);
    log(`  Statuses    : ${statuses.join(', ')}`);
    log(`  Generated   : ${fmtIST(new Date())}`);
    log('='.repeat(100));

    // Orders whose status RIGHT NOW is Packaging/Packed (soft-deleted / merged orders are skipped)
    const where = { orderStatus: { [Op.in]: statuses } };
    if (!allDates) {
        where[Op.or] = [
            { deliveryDate: targetDate },
            { createdAt: { [Op.between]: [startOfDay, endOfDay] } },
            { packagingAt: { [Op.between]: [startOfDay, endOfDay] } },
            { packedAt: { [Op.between]: [startOfDay, endOfDay] } }
        ];
    }

    const orders = await Order.findAll({
        where,
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
        order: [['orderStatus', 'ASC'], ['createdAt', 'ASC'], [{ model: OrderItem, as: 'items' }, 'createdAt', 'ASC']]
    });

    if (!orders.length) {
        log('');
        log(`  ✅ No order is in ${statuses.join('/')} status for ${allDates ? 'any date' : targetDate}.`);
        await reportOlder(new Set());
        finish([]);
        return;
    }

    const orderIds = orders.map(o => o.id);

    // Full status-change history of these orders (activity log)
    const historyByOrder = new Map();
    const history = await ActivityLog.findAll({
        where: {
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

    const productTotals = new Map();
    const summary = { byStatus: {}, byRoute: {}, byGodown: {}, totalAmount: 0, totalItems: 0 };
    const jsonOut = [];

    orders.forEach((o, idx) => {
        const why = allDates ? [] : todayReasons(o);

        const partyName = o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName || '-';
        const ownerName = o.user?.fullname || o.customerName || '-';
        const phone = o.user?.number || o.customerNumber || '-';
        const routeName = o.routeCategory?.name || '-';
        const godownName = o.godown?.name || '-';

        summary.byStatus[o.orderStatus] = (summary.byStatus[o.orderStatus] || 0) + 1;
        summary.byRoute[routeName] = (summary.byRoute[routeName] || 0) + 1;
        summary.byGodown[godownName] = (summary.byGodown[godownName] || 0) + 1;
        summary.totalAmount += num(o.totalAmount);
        summary.totalItems += o.items.length;

        log('');
        log('-'.repeat(100));
        log(`  #${idx + 1}  ORDER ${o.orderId}   [${o.orderStatus}]`);
        if (why.length) log(`      Today's because : ${why.join(', ')}`);
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
        log(`  Updated At        : ${fmtIST(o.updatedAt)}`);
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
            const productName = pickName(it.product?.name) || pickName(it.variantInfo?.productName) || '-';
            const variant = it.variant?.volume || it.variantInfo?.volume || '-';
            const extra = it.variantInfo?.extra ? ` ${it.variantInfo.extra}` : '';
            const lineTotal = num(it.price) * num(it.quantity) - num(it.discount);
            itemsTotal += lineTotal;
            log(`  ${pad(i + 1, 4)}${pad(productName, 40)}${pad(variant + extra, 16)}${padL(num(it.quantity), 8)} ${pad(it.sellUnit, 6)}${padL(num(it.price).toFixed(2), 11)}${padL(num(it.discount).toFixed(2), 10)}${padL(lineTotal.toFixed(2), 13)}`);

            const key = `${it.productId}|${it.variantId}|${it.sellUnit}`;
            const prev = productTotals.get(key) || { productName, variant: variant + extra, sellUnit: it.sellUnit, qty: 0, orders: 0 };
            prev.qty += num(it.quantity);
            prev.orders += 1;
            productTotals.set(key, prev);
        });
        log(`  ${' '.repeat(95)}${padL(itemsTotal.toFixed(2), 13)}`);

        const hist = historyByOrder.get(o.id) || [];
        if (hist.length) {
            log('');
            log(`  ACTIVITY HISTORY`);
            hist.forEach(h => {
                const m = h.metadata || {};
                const change = m.prevStatus || m.newStatus ? `  [${m.prevStatus || '?'} → ${m.newStatus || '?'}]` : '';
                log(`    ${fmtIST(h.createdAt)}  ${h.action}${change}  by ${h.userName || '-'} (${h.userType || '-'})  — ${h.description}`);
            });
        }

        jsonOut.push({
            todayReasons: why,
            ...o.toJSON(),
            activity: hist.map(h => h.toJSON())
        });
    });

    // ─── Summary ─────────────────────────────────────────────────────────────────────────
    log('');
    log('='.repeat(100));
    log('  SUMMARY');
    log('='.repeat(100));
    log(`  Total orders in ${statuses.join('/')} : ${orders.length}`);
    log(`  Total order value               : ${money(summary.totalAmount)}`);
    log(`  Total item lines                : ${summary.totalItems}`);
    log('');
    log('  By status:');
    Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));
    log('');
    log('  By route:');
    Object.entries(summary.byRoute).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));
    log('');
    log('  By godown:');
    Object.entries(summary.byGodown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`    ${pad(k, 30)} ${v}`));

    if (productTotals.size) {
        log('');
        log(`  PRODUCT-WISE QTY`);
        log(`  ${pad('Product', 44)}${pad('Variant', 18)}${pad('Unit', 8)}${padL('Qty', 10)}${padL('Orders', 8)}`);
        [...productTotals.values()]
            .sort((a, b) => a.productName.localeCompare(b.productName))
            .forEach(p => log(`  ${pad(p.productName, 44)}${pad(p.variant, 18)}${pad(p.sellUnit, 8)}${padL(p.qty, 10)}${padL(p.orders, 8)}`));
    }

    log('');
    log('  QUICK LIST');
    log(`  ${pad('No', 5)}${pad('Order', 17)}${pad('Status', 11)}${pad('Party / Shop', 30)}${pad('Phone', 15)}${pad('Route', 22)}${padL('Amount', 12)}  ${pad('Delivery', 11)}`);
    orders.forEach((o, i) => {
        const partyName = o.user?.businessProfile?.shopName || o.user?.fullname || o.customerName || '-';
        log(`  ${pad(i + 1, 5)}${pad(o.orderId, 17)}${pad(o.orderStatus, 11)}${pad(partyName, 30)}${pad(o.user?.number || o.customerNumber || '-', 15)}${pad(o.routeCategory?.name || '-', 22)}${padL(num(o.totalAmount).toFixed(2), 12)}  ${pad(o.deliveryDate || '-', 11)}`);
    });

    log('');
    log('  ORDER NUMBERS');
    log(`  ${orders.map(o => o.orderId).join(', ')}`);

    await reportOlder(new Set(orderIds));
    finish(jsonOut);
};

// Orders still sitting in Packaging/Packed that are NOT from the target date
const reportOlder = async (shownIds) => {
    if (allDates) return;
    const inStageNow = await Order.findAll({
        where: { orderStatus: { [Op.in]: statuses } },
        attributes: ['id', 'orderId', 'orderStatus', 'deliveryDate', 'createdAt', 'packagingAt', 'packedAt'],
        order: [['createdAt', 'ASC']]
    });
    const older = inStageNow.filter(o => !shownIds.has(o.id));
    if (!older.length) return;

    log('');
    log(`  ⚠️  ${older.length} more order(s) are in ${statuses.join('/')} from OTHER dates:`);
    older.forEach(s => log(`    ${pad(s.orderId, 16)} ${pad(s.orderStatus, 11)} delivery: ${pad(s.deliveryDate || '-', 11)} created: ${fmtIST(s.createdAt)}   packaging: ${fmtIST(s.packagingAt)}`));
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
