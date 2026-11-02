import { Order, PurchaseBill, OrderItem, OrderPayment, Product, ProductVariant, MainCategory, User, InventoryStock, Volume, HelpSupport, OutletOrder, OutletOrderItem, SalesReturn, PartyBalanceLog } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { Op, fn, literal } from 'sequelize';
import logger from '../../logger/apiLogger.js';
import { getPartyCurrentDue } from '../../services/partyLedger.service.js';

function getIndiaTimezoneRange(startDateStr, endDateStr) {
    let startYMD = startDateStr;
    let endYMD = endDateStr;

    if (startDateStr && startDateStr.includes('-')) {
        const parts = startDateStr.split('-');
        if (parts[2]?.length === 4) {
            startYMD = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }

    if (endDateStr && endDateStr.includes('-')) {
        const parts = endDateStr.split('-');
        if (parts[2]?.length === 4) {
            endYMD = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }

    if (!startYMD || !/^\d{4}-\d{2}-\d{2}$/.test(startYMD)) {
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
        startYMD = todayStr;
    }
    if (!endYMD || !/^\d{4}-\d{2}-\d{2}$/.test(endYMD)) {
        endYMD = startYMD;
    }
    if (endYMD < startYMD) {
        const tmp = startYMD;
        startYMD = endYMD;
        endYMD = tmp;
    }

    const startISO = new Date(`${startYMD}T00:00:00+05:30`);
    const endISO = new Date(`${endYMD}T23:59:59.999+05:30`);

    return { startISO, endISO, startYMD, endYMD };
}

// ── Business rules (same as Party Ledger — services/partyLedger.service.js) ──────────────────
const CANCELLED_STATUSES = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
// A bill is a sale from Packaging onwards (Party Ledger LEDGER_ORDER_STATUSES). Pending = not accepted yet.
const SALES_STATUSES = ['Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Completed'];
const DELIVERED_STATUSES = ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'];
const ORDER_STATUS_KEYS = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify'];
// Money received: same Cash / Bank methods as the Party Ledger Cash and Bank columns
const CASH_METHODS = ['CASH'];
const BANK_METHODS = ['ONLINE', 'BANK', 'CHEQUE', 'UPI', 'NEFT', 'RTGS'];
const MONEY_METHODS = [...CASH_METHODS, ...BANK_METHODS];
// Admin clearance records on bills that are not delivered yet are not money (same list as calculateOrderFinancials)
const PHANTOM_PAYMENT_NOTES = [
    'party balance cleared',
    'due cleared by admin',
    'advance jama credit by admin',
    'advance credit adjustment',
    'order settled in full via admin',
    'adjusted paid portion'
];
// Automatic balance-log notes the Party Ledger skips (they are already part of a bill)
const LEDGER_AUTO_NOTES = [
    'overpayment',
    'credit jama on order',
    'jama balance',
    'cash/online overpayment',
    'admin settlement',
    'delivery settlement',
    'delivery boy settlement',
    'credit (baki)',
    'goods given on credit',
    'order #',
    'on order',
    'advance jama on order',
    'advance jama used on order',
    'past due cleared',
    'settled during delivery'
];

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const toNum = (n) => {
    const v = Number(n);
    return Number.isFinite(v) ? v : 0;
};
const istYMD = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(d));
const addDaysYMD = (ymd, days) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;
const pickName = (nameObj, fallback = 'Product') => {
    if (!nameObj) return fallback;
    if (typeof nameObj === 'string') return nameObj;
    return nameObj.en || Object.values(nameObj)[0] || fallback;
};

// Bill amount (gross, before kupan) — same as calculateOrderFinancials().totalAmount used by the Party Ledger
const getOrderSalesAmount = (order) => {
    const raw = toNum(order.totalAmount);
    return raw > 0 ? raw : (toNum(order.paidAmount) + toNum(order.dueAmount));
};

// Bill date: orderDate (custom / back-dated sales) else the day the bill was created (IST)
const getOrderBillYMD = (order) => (order.orderDate ? String(order.orderDate).slice(0, 10) : istYMD(order.createdAt));

// Purchase cost of one sold line: loose (Inner) units cost purchasePrice / baseUnitsPerPack each
const getItemPacks = (item) => {
    const qty = toNum(item.quantity);
    const vInfo = item.variantInfo || {};
    const bUPP = toNum(vInfo.baseUnitsPerPack || item.variant?.baseUnitsPerPack || 1) || 1;
    return item.sellUnit === 'Inner' ? qty / bUPP : qty;
};
const getItemCost = (item) => {
    const vInfo = item.variantInfo || {};
    const purchasePrice = toNum(vInfo.purchasePrice || item.variant?.purchasePrice || 0);
    return getItemPacks(item) * purchasePrice;
};
const getItemRevenue = (item) => toNum(item.quantity) * toNum(item.price);

// Run async work for many items, a few at a time
const mapLimit = async (items, limit, worker) => {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const idx = next++;
            results[idx] = await worker(items[idx]);
        }
    });
    await Promise.all(runners);
    return results;
};

export const getDashboardStats = async (req, res) => {
    try {
        const { startDate, endDate, godownId } = req.query;

        const range = (startDate && endDate) ? getIndiaTimezoneRange(startDate, endDate) : null;
        const godownFilter = godownId ? { godownId } : {};
        const todayYMD = istYMD(new Date());

        // Trend window: the selected range, or the last 7 days when the range is shorter than a week
        let trendStartYMD = null;
        let trendEndYMD = null;
        if (range) {
            trendEndYMD = range.endYMD;
            trendStartYMD = daysBetween(range.startYMD, range.endYMD) < 7 ? addDaysYMD(range.endYMD, -6) : range.startYMD;
        }
        const fetchStartYMD = range ? (trendStartYMD < range.startYMD ? trendStartYMD : range.startYMD) : null;
        const fetchStartISO = range ? new Date(`${fetchStartYMD}T00:00:00+05:30`) : null;
        const trendGroup = (!range || daysBetween(trendStartYMD, trendEndYMD) > 92) ? 'month' : 'day';

        const inRange = (ymd) => !range || (ymd >= range.startYMD && ymd <= range.endYMD);
        const inTrend = (ymd) => !range || (ymd >= trendStartYMD && ymd <= trendEndYMD);

        // Each bill has exactly one bill date, so it is counted in one period only
        const orderBillDateWhere = range ? {
            [Op.or]: [
                { orderDate: { [Op.between]: [fetchStartYMD, range.endYMD] } },
                { orderDate: null, createdAt: { [Op.between]: [fetchStartISO, range.endISO] } }
            ]
        } : {};
        const outletDateWhere = range ? { createdAt: { [Op.between]: [fetchStartISO, range.endISO] } } : {};
        const mainCreatedAtWhere = range ? { createdAt: { [Op.between]: [range.startISO, range.endISO] } } : {};

        const itemInclude = (model) => ({
            model,
            as: 'items',
            attributes: ['id', 'productId', 'variantId', 'quantity', 'price', 'sellUnit', 'variantInfo'],
            required: false,
            include: [
                { model: ProductVariant, as: 'variant', attributes: ['id', 'purchasePrice', 'baseUnitsPerPack'], required: false, paranoid: false },
                { model: Product, as: 'product', attributes: ['id', 'name', 'mainCategoryId', 'thumbnail'], required: false, paranoid: false }
            ]
        });

        const todayStartISO = new Date(`${todayYMD}T00:00:00+05:30`);
        const todayEndISO = new Date(`${todayYMD}T23:59:59.999+05:30`);

        const [
            orders,
            outletOrders,
            orderPayments,
            manualPayments,
            salesReturns,
            purchaseTotalRaw,
            purchaseBillCount,
            partyBalanceRow,
            outletDueRow,
            activeParties,
            stockRows,
            todayAppOrderCount,
            todayOutletOrderCount,
            pendingHelpSupportCount
        ] = await Promise.all([
            // 1. App + Direct (custom sale) bills in the window, all statuses
            Order.findAll({
                where: { ...orderBillDateWhere, ...godownFilter },
                attributes: [
                    'id', 'orderId', 'userId', 'saleType', 'orderStatus', 'paymentMethod', 'totalAmount', 'paidAmount', 'dueAmount', 'couponDiscount', 'orderDate', 'createdAt',
                    [literal(`EXISTS (SELECT 1 FROM "order_payments" AS "op" WHERE "op"."orderId" = "Order"."id" AND UPPER("op"."paymentMethod") IN (${MONEY_METHODS.map(m => `'${m}'`).join(', ')}))`), 'hasMoneyPayment']
                ],
                include: [itemInclude(OrderItem)]
            }),
            // 2. Outlet orders in the window, all statuses
            OutletOrder.findAll({
                where: { ...outletDateWhere, ...godownFilter },
                attributes: ['id', 'orderId', 'userId', 'orderStatus', 'totalAmount', 'discountAmount', 'grandTotal', 'paidAmount', 'paymentMode', 'payments', 'createdAt'],
                include: [itemInclude(OutletOrderItem)]
            }),
            // 3. Cash / Bank received on app + direct bills, by payment date
            OrderPayment.findAll({
                where: {
                    ...mainCreatedAtWhere,
                    amount: { [Op.gt]: 0 }
                },
                attributes: ['id', 'amount', 'paymentMethod', 'notes', 'createdAt'],
                include: [{
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderStatus'],
                    required: true,
                    where: { ...godownFilter, orderStatus: { [Op.notIn]: CANCELLED_STATUSES } }
                }]
            }),
            // 4. Manual payments entered in the Party Ledger (not linked to a bill) — no godown on these
            godownId ? Promise.resolve([]) : PartyBalanceLog.findAll({
                where: {
                    ...mainCreatedAtWhere,
                    orderId: null,
                    type: { [Op.in]: ['JAMA', 'PAYMENT', 'jama', 'payment'] },
                    amount: { [Op.gt]: 0 }
                },
                attributes: ['id', 'amount', 'note', 'createdAt']
            }),
            // 5. Sales returns created in the period
            SalesReturn.findAll({
                where: {
                    ...mainCreatedAtWhere,
                    status: { [Op.notIn]: ['Cancelled', 'Rejected'] }
                },
                attributes: ['id', 'orderId', 'returnAmount', 'quantity', 'price', 'reason'],
                include: godownId
                    ? [{ model: Order, as: 'order', attributes: ['id'], required: true, where: { godownId } }]
                    : []
            }),
            // 6. Purchase bills received in the period
            PurchaseBill.sum('totalAmount', {
                where: { ...godownFilter, ...(range ? { receivedDate: { [Op.between]: [range.startISO, range.endISO] } } : {}) }
            }),
            PurchaseBill.count({
                where: { ...godownFilter, ...(range ? { receivedDate: { [Op.between]: [range.startISO, range.endISO] } } : {}) }
            }),
            // 7. Party balances — same source as the Users page "Party Due" total (ledger closing balance)
            User.findOne({
                where: { status: { [Op.ne]: 'Deleted' }, ...godownFilter },
                attributes: [
                    [fn('COALESCE', fn('SUM', literal(`CASE WHEN "User"."closingBalance" > 0 THEN "User"."closingBalance" ELSE 0 END`)), 0), 'partyDue'],
                    [fn('COALESCE', fn('SUM', literal(`CASE WHEN "User"."closingBalance" < 0 THEN -"User"."closingBalance" ELSE 0 END`)), 0), 'advanceJama'],
                    [fn('COUNT', literal(`CASE WHEN "User"."closingBalance" > 0 THEN 1 END`)), 'partyDueCount'],
                    [fn('COUNT', literal(`CASE WHEN "User"."closingBalance" < 0 THEN 1 END`)), 'advanceJamaCount']
                ],
                raw: true
            }),
            // 8. Outlet bills not fully paid (current, not period)
            OutletOrder.findOne({
                where: {
                    ...godownFilter,
                    orderStatus: { [Op.notIn]: [...CANCELLED_STATUSES, 'Pending'] }
                },
                attributes: [
                    [fn('COALESCE', fn('SUM', literal(`GREATEST(COALESCE("OutletOrder"."grandTotal", 0) - COALESCE("OutletOrder"."paidAmount", 0), 0)`)), 0), 'outletDue'],
                    [fn('COUNT', literal(`CASE WHEN COALESCE("OutletOrder"."grandTotal", 0) - COALESCE("OutletOrder"."paidAmount", 0) > 0.009 THEN 1 END`)), 'outletDueCount']
                ],
                raw: true
            }),
            User.count({ where: { status: 'Active', ...godownFilter } }),
            // 9. Current stock value at purchase price
            InventoryStock.findAll({
                where: { status: 'Active', ...godownFilter },
                attributes: ['totalBaseUnits', 'avgPurchasePricePerBaseUnit'],
                include: [{ model: ProductVariant, as: 'variant', attributes: ['purchasePrice', 'baseUnitsPerPack'], required: false }]
            }),
            // 10. Today's orders (app + direct + outlet), cancelled not counted
            Order.count({
                where: {
                    ...godownFilter,
                    orderStatus: { [Op.notIn]: CANCELLED_STATUSES },
                    [Op.or]: [
                        { orderDate: todayYMD },
                        { orderDate: null, createdAt: { [Op.between]: [todayStartISO, todayEndISO] } }
                    ]
                }
            }),
            OutletOrder.count({
                where: {
                    ...godownFilter,
                    orderStatus: { [Op.notIn]: CANCELLED_STATUSES },
                    createdAt: { [Op.between]: [todayStartISO, todayEndISO] }
                }
            }),
            HelpSupport.count({ where: { status: 'Pending' } })
        ]);

        // ── Period aggregation ──────────────────────────────────────────────────────────────
        const sales = { online: 0, direct: 0, outlet: 0 };
        let totalPurchaseCost = 0;
        let billCount = 0;
        let outletBillCount = 0;
        let kupanApp = 0;
        let kupanOutlet = 0;
        const received = { appCash: 0, appBank: 0, outletCash: 0, outletBank: 0, manualCash: 0 };
        const pending = { appCount: 0, appAmount: 0, outletDraftCount: 0, outletDraftAmount: 0 };
        const cancelled = { count: 0, amount: 0 };
        const orderStatusCounts = ORDER_STATUS_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), { Cancelled: 0 });
        const orderingParties = new Set();
        const trendMap = new Map();
        const productMap = new Map();
        const categoryMap = new Map();

        const trendKey = (ymd) => (trendGroup === 'month' ? ymd.slice(0, 7) : ymd);
        const addTrend = (ymd, salesAmt, costAmt) => {
            if (!inTrend(ymd)) return;
            const key = trendKey(ymd);
            const row = trendMap.get(key) || { sales: 0, cost: 0, bills: 0 };
            row.sales += salesAmt;
            row.cost += costAmt;
            row.bills += 1;
            trendMap.set(key, row);
        };
        const addItems = (items) => {
            for (const it of items || []) {
                const pid = it.productId || it.product?.id;
                if (!pid) continue;
                const revenue = getItemRevenue(it);
                const cost = getItemCost(it);
                const packs = getItemPacks(it);
                const prod = productMap.get(pid) || {
                    productId: pid,
                    productName: pickName(it.product?.name || it.variantInfo?.productName),
                    image: it.product?.thumbnail || it.variantInfo?.image || null,
                    totalQty: 0,
                    totalRevenue: 0,
                    totalCost: 0
                };
                prod.totalQty += packs;
                prod.totalRevenue += revenue;
                prod.totalCost += cost;
                productMap.set(pid, prod);

                const catId = it.product?.mainCategoryId;
                if (catId) {
                    const cat = categoryMap.get(catId) || { categoryId: catId, totalQty: 0, totalRevenue: 0 };
                    cat.totalQty += packs;
                    cat.totalRevenue += revenue;
                    categoryMap.set(catId, cat);
                }
            }
        };

        // App + Direct bills
        for (const o of orders) {
            const status = o.orderStatus;
            const ymd = getOrderBillYMD(o);
            const isMain = inRange(ymd);
            const amount = getOrderSalesAmount(o);

            if (CANCELLED_STATUSES.includes(status)) {
                if (isMain) {
                    orderStatusCounts.Cancelled += 1;
                    cancelled.count += 1;
                    cancelled.amount += amount;
                }
                continue;
            }

            if (isMain) {
                if (orderStatusCounts[status] !== undefined) orderStatusCounts[status] += 1;

                // Money already taken on a bill that has no Cash / Bank payment record (e.g. prepaid online app order)
                if (!o.get('hasMoneyPayment') && toNum(o.paidAmount) > 0) {
                    const method = String(o.paymentMethod || 'CASH').toUpperCase();
                    if (CASH_METHODS.includes(method) || method === 'COD') received.appCash += toNum(o.paidAmount);
                    else if (BANK_METHODS.includes(method)) received.appBank += toNum(o.paidAmount);
                }
            }

            if (status === 'Pending') {
                if (isMain) {
                    pending.appCount += 1;
                    pending.appAmount += amount;
                }
                continue;
            }
            if (!SALES_STATUSES.includes(status)) continue;

            const cost = (o.items || []).reduce((sum, it) => sum + getItemCost(it), 0);
            addTrend(ymd, amount, cost);
            if (!isMain) continue;

            if (o.saleType === 'Direct') sales.direct += amount;
            else sales.online += amount;
            totalPurchaseCost += cost;
            billCount += 1;
            kupanApp += toNum(o.couponDiscount);
            if (o.userId) orderingParties.add(o.userId);
            addItems(o.items);
        }

        // Outlet bills (Pending = draft, not a sale yet)
        for (const o of outletOrders) {
            const status = o.orderStatus;
            const ymd = istYMD(o.createdAt);
            const isMain = inRange(ymd);
            if (CANCELLED_STATUSES.includes(status)) continue;

            // Cash / Bank taken on the outlet bill (outlet payments carry no date of their own)
            if (isMain) {
                const pmList = Array.isArray(o.payments) && o.payments.length > 0
                    ? o.payments
                    : [{ method: o.paymentMode || 'Cash', amount: o.paidAmount }];
                for (const pm of pmList) {
                    const amt = toNum(pm?.amount);
                    if (amt <= 0) continue;
                    const m = String(pm?.method || pm?.paymentMode || '').toLowerCase();
                    if (m.includes('kupan') || m.includes('coupon') || m.includes('return')) continue;
                    if (m.includes('bank') || m.includes('online') || m.includes('upi') || pm?.bankSettingId) received.outletBank += amt;
                    else received.outletCash += amt;
                }
            }

            const gross = toNum(o.totalAmount) > 0 ? toNum(o.totalAmount) : (toNum(o.grandTotal) + toNum(o.discountAmount));
            if (status === 'Pending') {
                if (isMain) {
                    pending.outletDraftCount += 1;
                    pending.outletDraftAmount += gross;
                }
                continue;
            }

            const cost = (o.items || []).reduce((sum, it) => sum + getItemCost(it), 0);
            addTrend(ymd, gross, cost);
            if (!isMain) continue;

            sales.outlet += gross;
            totalPurchaseCost += cost;
            outletBillCount += 1;
            kupanOutlet += toNum(o.discountAmount);
            if (o.userId) orderingParties.add(o.userId);
            addItems(o.items);
        }

        // Cash / Bank payment records on app + direct bills
        for (const p of orderPayments) {
            const method = String(p.paymentMethod || '').toUpperCase();
            const isDeliveredBill = DELIVERED_STATUSES.includes(p.order?.orderStatus);
            const note = String(p.notes || '').toLowerCase();
            if (!isDeliveredBill && PHANTOM_PAYMENT_NOTES.some(n => note.includes(n))) continue;
            if (CASH_METHODS.includes(method)) received.appCash += toNum(p.amount);
            else if (BANK_METHODS.includes(method)) received.appBank += toNum(p.amount);
        }

        // Manual Party Ledger payments (shown as Cash in the ledger)
        for (const log of manualPayments) {
            const note = String(log.note || '').toLowerCase();
            if (LEDGER_AUTO_NOTES.some(n => note.includes(n))) continue;
            received.manualCash += toNum(log.amount);
        }

        // Sales returns (stock-only returns of bills cancelled after shipping are never a party credit)
        let salesReturnTotal = 0;
        let salesReturnCount = 0;
        for (const r of salesReturns) {
            if (String(r.reason || '').trim().toLowerCase().startsWith('cancelled after shipping')) continue;
            const amt = toNum(r.returnAmount) || (toNum(r.quantity) * toNum(r.price));
            if (amt <= 0) continue;
            salesReturnTotal += amt;
            salesReturnCount += 1;
        }

        // ── Totals ─────────────────────────────────────────────────────────────────────────
        const totalSales = round2(sales.online + sales.direct + sales.outlet);
        const totalProfit = round2(totalSales - totalPurchaseCost);
        const totalBills = billCount + outletBillCount;
        const cashReceived = round2(received.appCash + received.outletCash + received.manualCash);
        const bankReceived = round2(received.appBank + received.outletBank);
        const totalReceived = round2(cashReceived + bankReceived);
        const kupanTotal = round2(kupanApp + kupanOutlet);
        const totalPurchase = round2(purchaseTotalRaw || 0);

        // Party due right now (Party Ledger rule, getPartyCurrentDue): verified bills are in the saved ledger
        // closing balance; a party whose latest delivered bill is not verified yet owes that bill's own due.
        let partyDueSum = toNum(partyBalanceRow?.partyDue);
        let advanceJamaSum = toNum(partyBalanceRow?.advanceJama);
        let partyDueCount = Number(partyBalanceRow?.partyDueCount || 0);
        let advanceJamaCount = Number(partyBalanceRow?.advanceJamaCount || 0);
        let awaitingVerifyParties = 0;
        try {
            const unverifiedRows = await Order.findAll({
                where: {
                    userId: { [Op.ne]: null },
                    orderStatus: { [Op.in]: ['Delivered', 'Payment Collect'] },
                    paymentCollectStatus: { [Op.ne]: 'Verified' }
                },
                attributes: ['userId'],
                group: ['userId'],
                raw: true
            });
            const unverifiedUserIds = unverifiedRows.map(r => r.userId).filter(Boolean);
            const partiesToCheck = unverifiedUserIds.length
                ? await User.findAll({
                    where: { id: unverifiedUserIds, status: { [Op.ne]: 'Deleted' }, ...godownFilter },
                    attributes: ['id', 'closingBalance']
                })
                : [];
            awaitingVerifyParties = partiesToCheck.length;
            await mapLimit(partiesToCheck, 5, async (party) => {
                try {
                    const current = await getPartyCurrentDue(party.id);
                    const saved = toNum(party.closingBalance);
                    // Replace this party's saved balance with its current due / jama
                    if (saved > 0) { partyDueSum -= saved; partyDueCount -= 1; }
                    if (saved < 0) { advanceJamaSum -= Math.abs(saved); advanceJamaCount -= 1; }
                    const due = toNum(current.totalDue);
                    const jama = toNum(current.advanceJama);
                    if (due > 0.005) { partyDueSum += due; partyDueCount += 1; }
                    else if (jama > 0.005) { advanceJamaSum += jama; advanceJamaCount += 1; }
                } catch (partyErr) {
                    logger.warn(`[Dashboard party due] ${party.id}: ${partyErr.message}`);
                }
            });
        } catch (dueErr) {
            logger.warn(`[Dashboard party due check]: ${dueErr.message}`);
        }

        const partyDue = round2(Math.max(0, partyDueSum));
        const advanceJama = round2(Math.max(0, advanceJamaSum));
        const outletDue = round2(outletDueRow?.outletDue || 0);
        const totalOutstanding = round2(partyDue + outletDue);

        let stockValue = 0;
        let stockUnits = 0;
        for (const s of stockRows) {
            const units = toNum(s.totalBaseUnits);
            if (units <= 0) continue;
            const avg = toNum(s.avgPurchasePricePerBaseUnit);
            const bUPP = toNum(s.variant?.baseUnitsPerPack || 1) || 1;
            const perUnit = avg > 0 ? avg : (toNum(s.variant?.purchasePrice) / bUPP);
            stockValue += units * perUnit;
            stockUnits += units;
        }

        // Sales trend: every day (or month) of the window, empty ones as 0
        const salesTrend = [];
        if (range) {
            if (trendGroup === 'day') {
                for (let d = trendStartYMD; d <= trendEndYMD; d = addDaysYMD(d, 1)) {
                    const row = trendMap.get(d) || { sales: 0, cost: 0, bills: 0 };
                    salesTrend.push({ date: d, total: round2(row.sales), cost: round2(row.cost), profit: round2(row.sales - row.cost), bills: row.bills });
                }
            } else {
                let m = trendStartYMD.slice(0, 7);
                const lastM = trendEndYMD.slice(0, 7);
                while (m <= lastM) {
                    const row = trendMap.get(m) || { sales: 0, cost: 0, bills: 0 };
                    salesTrend.push({ date: m, total: round2(row.sales), cost: round2(row.cost), profit: round2(row.sales - row.cost), bills: row.bills });
                    const [y, mo] = m.split('-').map(Number);
                    m = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
                }
            }
        } else {
            [...trendMap.keys()].sort().forEach(k => {
                const row = trendMap.get(k);
                salesTrend.push({ date: k, total: round2(row.sales), cost: round2(row.cost), profit: round2(row.sales - row.cost), bills: row.bills });
            });
        }

        // Top products (by sales amount)
        const enrichedProducts = [...productMap.values()]
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, 10)
            .map(p => ({
                productId: p.productId,
                productName: p.productName,
                product: { id: p.productId, name: p.productName },
                image: p.image,
                totalQty: round2(p.totalQty),
                totalRevenue: round2(p.totalRevenue),
                totalCost: round2(p.totalCost),
                totalProfit: round2(p.totalRevenue - p.totalCost)
            }));

        // Top categories (by sales amount)
        const topCategoryRows = [...categoryMap.values()].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
        const categoryTitles = topCategoryRows.length
            ? await MainCategory.findAll({ where: { id: topCategoryRows.map(c => c.categoryId) }, attributes: ['id', 'title'], paranoid: false })
            : [];
        const enrichedCategories = topCategoryRows.map(c => {
            const cat = categoryTitles.find(t => t.id === c.categoryId);
            return {
                categoryId: c.categoryId,
                categoryName: pickName(cat?.title, 'Category'),
                totalQty: round2(c.totalQty),
                totalRevenue: round2(c.totalRevenue),
                share: totalSales > 0 ? round2((c.totalRevenue / totalSales) * 100) : 0
            };
        });

        // 8. Product Expiry Soon (Next 30 days)
        const expirySoon = await InventoryStock.findAll({
            where: {
                ...godownFilter,
                expiryDate: {
                    [Op.and]: [
                        { [Op.gt]: new Date() },
                        { [Op.lt]: new Date(new Date().setDate(new Date().getDate() + 30)) }
                    ]
                }
            },
            include: [
                { model: Product, as: 'product', attributes: ['name'] },
                { model: ProductVariant, as: 'variant', attributes: ['volume'] }
            ],
            limit: 5,
            order: [['expiryDate', 'ASC']]
        });

        const enrichedExpiry = expirySoon.map(item => {
            const d = item.toJSON();
            const name = d.product?.name?.en || Object.values(d.product?.name || {})[0] || 'Product';
            if (d.product) d.product.name = name;
            return d;
        });

        // 9.1 Low Stock Count & List
        const activeProducts = await Product.findAll({
            where: { status: 'Active' },
            attributes: ['id', 'name', 'thumbnail'],
            include: [
                {
                    model: ProductVariant,
                    as: 'variants',
                    where: { status: 'Active' },
                    required: true,
                    include: [
                        {
                            model: Volume,
                            as: 'volumeRef',
                            attributes: ['id', 'name']
                        },
                        {
                            model: InventoryStock,
                            as: 'inventoryStocks',
                            attributes: ['totalBaseUnits', 'status'],
                            where: godownId ? { godownId } : undefined,
                            required: false
                        }
                    ]
                }
            ]
        });

        let lowStockCount = 0;
        const lowStockProducts = [];

        for (const product of activeProducts) {
            const variants = product.variants || [];
            if (variants.length === 0) continue;

            let allVariantsLow = true;
            const variantStocks = [];

            for (const variant of variants) {
                const activeStocks = (variant.inventoryStocks || []).filter(s => s.status === 'Active');
                const totalStock = activeStocks.reduce((sum, s) => sum + parseFloat(s.totalBaseUnits || 0), 0);

                if (totalStock > 10) {
                    allVariantsLow = false;
                }

                const unitNameObj = variant.volumeRef?.name || {};
                const unitName = unitNameObj.en || Object.values(unitNameObj)[0] || '';
                const fullVolume = `${variant.volume || ''} ${unitName}`.trim();

                variantStocks.push({
                    variantId: variant.id,
                    volume: fullVolume || variant.volume,
                    totalStock: totalStock
                });
            }

            if (allVariantsLow) {
                lowStockCount++;
                const pName = product.name?.en || Object.values(product.name || {})[0] || 'Product';
                lowStockProducts.push({
                    productId: product.id,
                    productName: pName,
                    image: product.thumbnail,
                    variants: variantStocks
                });
            }
        }

        const deliveredOrderCount = orderStatusCounts.Delivered + orderStatusCounts['Payment Collect'] + orderStatusCounts['Payment Verify'];

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Dashboard stats fetched successfully.", {
            summary: {
                // Existing keys (kept for older screens)
                totalSales,
                totalPurchase,
                totalOutstanding,
                totalReceived,
                totalPayable: totalPurchase, // vendor payments are not recorded; kept only for older screens
                totalProfit,
                newOrderCount: orderStatusCounts.Pending,
                deliveredOrderCount,
                todayTotalOrder: todayAppOrderCount + todayOutletOrderCount,
                lowStockCount,
                pendingHelpSupportCount,
                activeParties,
                // Detail
                salesBreakdown: {
                    online: round2(sales.online),
                    direct: round2(sales.direct),
                    outlet: round2(sales.outlet)
                },
                totalPurchaseCost: round2(totalPurchaseCost),
                profitMargin: totalSales > 0 ? round2((totalProfit / totalSales) * 100) : 0,
                totalBills,
                appBillCount: billCount,
                outletBillCount,
                avgBillValue: totalBills > 0 ? round2(totalSales / totalBills) : 0,
                orderingParties: orderingParties.size,
                received: {
                    cash: cashReceived,
                    bank: bankReceived,
                    total: totalReceived,
                    appCash: round2(received.appCash),
                    appBank: round2(received.appBank),
                    outletCash: round2(received.outletCash),
                    outletBank: round2(received.outletBank),
                    manualCash: round2(received.manualCash)
                },
                kupan: kupanTotal,
                salesReturn: round2(salesReturnTotal),
                salesReturnCount,
                purchaseBillCount,
                outstanding: {
                    partyDue,
                    partyDueCount: Math.max(0, partyDueCount),
                    advanceJama,
                    advanceJamaCount: Math.max(0, advanceJamaCount),
                    awaitingVerifyParties,
                    outletDue,
                    outletDueCount: Number(outletDueRow?.outletDueCount || 0),
                    total: totalOutstanding
                },
                stockValue: round2(stockValue),
                stockUnits: round2(stockUnits),
                pending: {
                    appCount: pending.appCount,
                    appAmount: round2(pending.appAmount),
                    outletDraftCount: pending.outletDraftCount,
                    outletDraftAmount: round2(pending.outletDraftAmount),
                    totalCount: pending.appCount + pending.outletDraftCount,
                    totalAmount: round2(pending.appAmount + pending.outletDraftAmount)
                },
                cancelled: {
                    count: cancelled.count,
                    amount: round2(cancelled.amount)
                },
                orderStatusCounts
            },
            paymentBifurcation: [
                { paymentMethod: 'Cash', total: cashReceived },
                { paymentMethod: 'Bank', total: bankReceived },
                { paymentMethod: 'Kupan', total: kupanTotal },
                { paymentMethod: 'Sales Return', total: round2(salesReturnTotal) }
            ],
            topProducts: enrichedProducts,
            topCategories: enrichedCategories,
            expirySoon: enrichedExpiry,
            salesTrend,
            lowStockProducts,
            range: range ? {
                startDate: range.startYMD,
                endDate: range.endYMD,
                trendStartDate: trendStartYMD,
                trendEndDate: trendEndYMD,
                trendGroup
            } : { trendGroup }
        });
    } catch (error) {
        logger.error(`[Dashboard Stats Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
