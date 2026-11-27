import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import { Order, User, BusinessProfile } from '../models/index.js';
import { syncPartyLedger } from './partyLedger.service.js';
import logger from '../logger/apiLogger.js';

/**
 * Daily Order No. Hisab — every party that has started ordering, one line each, for one day (India time),
 * highest closing balance first, taken from the Party Ledger:
 *   Opening + Today Sales − Cash − Bank − Kupan − Return = Closing
 * Opening / Closing are the party's running ledger balance at the start / end of the day, so this page
 * always agrees with the Party Ledger (nothing is stored here: every load reads the ledger again).
 * Like the ledger, a bill counts only after its payment is verified; bills of the day still waiting for
 * Payment Verify are listed separately (pending) and not added.
 */

const CANCELLED_STATUSES = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 330 * 60 * 1000;
const WORKERS = 6;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const sum = (rows, key) => r2(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0));
const last10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
const billSortKey = (no) => Number(String(no || '').replace(/\D/g, '')) || Number.MAX_SAFE_INTEGER;
const signedOpening = (u) => {
    const raw = Math.max(0, Number(u?.openingBalance || 0));
    return String(u?.openingBalanceType || 'CR').toUpperCase() === 'DR' ? -raw : raw;
};

/** Today's date in India as YYYY-MM-DD. */
export const todayIST = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);

/** Run fn over items with a few at a time (DB pool is small). */
const mapLimit = async (items, limit, fn) => {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i], i);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
};

/**
 * Parties that have started ordering: at least one order that is not cancelled
 * (by userId, or by the party's phone like the Party Ledger). Parties that never ordered are not listed.
 */
const findOrderingParties = async () => {
    const notCancelled = CANCELLED_STATUSES.map((s) => `'${s}'`).join(', ');
    const [orderUsers, orderPhones] = await Promise.all([
        sequelize.query(`SELECT DISTINCT "userId" AS id FROM orders WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL AND "orderStatus" NOT IN (${notCancelled})`, { type: 'SELECT' }),
        sequelize.query(`SELECT DISTINCT RIGHT(REGEXP_REPLACE("customerNumber", '[^0-9]', '', 'g'), 10) AS phone FROM orders WHERE "deletedAt" IS NULL AND "customerNumber" IS NOT NULL AND "orderStatus" NOT IN (${notCancelled})`, { type: 'SELECT' }),
    ]);
    return {
        ids: new Set(orderUsers.map((r) => String(r.id))),
        phones: new Set(orderPhones.map((r) => r.phone).filter((p) => p && p.length >= 7)),
    };
};

/** Orders placed on this day, per party (shown as "Pending / Confirmed" when no bill yet). */
const findOrdersPlaced = async (start, end, phoneToUser) => {
    const orders = await Order.findAll({
        where: { orderStatus: { [Op.notIn]: CANCELLED_STATUSES }, createdAt: { [Op.gte]: start, [Op.lt]: end } },
        attributes: ['id', 'orderId', 'userId', 'customerNumber', 'orderStatus', 'totalAmount'],
    });
    const byParty = new Map();
    for (const o of orders) {
        const uid = o.userId || phoneToUser.get(last10(o.customerNumber));
        if (!uid) continue;
        if (!byParty.has(String(uid))) byParty.set(String(uid), []);
        byParty.get(String(uid)).push({ id: o.id, orderId: o.orderId, status: o.orderStatus, amount: r2(o.totalAmount) });
    }
    return byParty;
};

const emptyLine = (party, balance) => ({
    userId: party.id,
    partyName: party.businessProfile?.shopName || party.businessProfile?.shopNameAlt || party.fullname || '-',
    mobile: party.number ? `+91 ${party.number}` : '',
    area: party.city || '',
    opening: r2(balance),
    sales: 0,
    cash: 0,
    bank: 0,
    bankReceiver: '',
    kupan: 0,
    returnVal: 0,
    closing: r2(balance),
    adjust: 0,
    bills: [],
    pending: [],
    openOrders: [],
    active: false,
    sortKey: Number.MAX_SAFE_INTEGER,
});

/** One party's line for the day, from its running ledger (read only). */
const buildPartyLine = async (party, startMs, endMs, placedToday = []) => {
    const synced = await syncPartyLedger(party.id, { persist: false });
    const rows = synced.ledgerRows || [];
    const inDay = (r) => {
        const t = r.dateObj.getTime();
        return t >= startMs && t < endMs;
    };

    const dayRows = rows.filter(inDay);
    let opening;
    const firstDayIdx = rows.findIndex(inDay);
    if (firstDayIdx >= 0) {
        opening = Number(rows[firstDayIdx].openingBalance);
    } else {
        opening = signedOpening(synced.user);
        for (const r of rows) {
            if (r.dateObj.getTime() >= startMs) continue;
            if (r.closingBalance !== null && r.closingBalance !== undefined) opening = Number(r.closingBalance);
        }
    }

    const verified = dayRows.filter((r) => r.closingBalance !== null && r.closingBalance !== undefined);
    const closing = verified.length ? Number(verified[verified.length - 1].closingBalance) : opening;
    const sales = sum(verified, 'sales');
    const cash = sum(verified, 'cash');
    const bank = sum(verified, 'bank');
    const kupan = sum(verified, 'kupan');
    const returnVal = sum(verified, 'returnVal');
    // Balance reset / write-off lines change the balance without sales or payment
    const adjust = r2(closing - (opening + sales - cash - bank - kupan - returnVal));

    const ledgerOrderIds = new Set(dayRows.map((r) => r.orderId).filter(Boolean));
    const pending = dayRows
        .filter((r) => r.orderId && (r.closingBalance === null || r.closingBalance === undefined))
        .map((r) => ({ orderId: r.orderId, billNo: r.billNo, amount: r2(r.sales) }));
    const openOrders = placedToday.filter((o) => !ledgerOrderIds.has(o.id));
    const receivers = [...new Set(verified.map((r) => r.bankReceiver).filter((x) => x && x !== '-'))];
    const firstNo = [...dayRows.map((r) => r.billNo), ...openOrders.map((o) => o.orderId)]
        .map(billSortKey)
        .reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER);

    return {
        ...emptyLine(party, opening),
        partyName: synced.user?.shopName || synced.user?.fullname || emptyLine(party, 0).partyName,
        opening: r2(opening),
        sales,
        cash,
        bank,
        bankReceiver: receivers.join(', '),
        kupan,
        returnVal,
        closing: r2(closing),
        adjust: Math.abs(adjust) >= 0.01 ? adjust : 0,
        bills: verified.filter((r) => r.orderId).map((r) => r.billNo),
        pending,
        openOrders,
        active: dayRows.length > 0 || openOrders.length > 0,
        sortKey: firstNo,
    };
};

/**
 * @param {string} date YYYY-MM-DD (India date); default today
 * @param {Object} [options] { godownId } — only parties of that godown
 */
export const getDailyPartyHisab = async (date, { godownId = null } = {}) => {
    const t0 = Date.now();
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : todayIST();
    const start = new Date(`${day}T00:00:00.000+05:30`);
    const end = new Date(start.getTime() + DAY_MS);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const allParties = await User.findAll({
        where: { status: { [Op.ne]: 'Deleted' }, ...(godownId ? { godownId } : {}) },
        attributes: ['id', 'fullname', 'number', 'city', 'openingBalance', 'openingBalanceType'],
        include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopNameAlt'], required: false }],
    });
    const ordering = await findOrderingParties();
    const parties = allParties.filter((p) => ordering.ids.has(String(p.id)) || ordering.phones.has(last10(p.number)));
    const phoneToUser = new Map(parties.filter((p) => last10(p.number).length >= 7).map((p) => [last10(p.number), p.id]));
    const placed = await findOrdersPlaced(start, end, phoneToUser);

    const failed = [];
    const lines = await mapLimit(parties, WORKERS, async (party) => {
        try {
            return await buildPartyLine(party, startMs, endMs, placed.get(String(party.id)) || []);
        } catch (err) {
            logger.error(`[Daily Party Hisab] party ${party.id}: ${err.message}`);
            failed.push(party.id);
            return null;
        }
    });

    // Highest closing balance (most due) on top, jama (minus) at the bottom
    const list = lines.filter(Boolean).sort((a, b) =>
        (b.closing - a.closing) ||
        (a.sortKey - b.sortKey) ||
        String(a.partyName).localeCompare(String(b.partyName), 'gu'));
    const rows = list.map(({ sortKey, ...line }, i) => ({ sr: i + 1, ...line }));

    const pendingBills = rows.flatMap((r) => r.pending);
    logger.info(`[Daily Party Hisab] ${day}: ${rows.length} parties (${rows.filter((r) => r.active).length} active) in ${Date.now() - t0} ms`);
    return {
        date: day,
        rows,
        totals: {
            parties: rows.length,
            activeParties: rows.filter((r) => r.active).length,
            opening: sum(rows, 'opening'),
            sales: sum(rows, 'sales'),
            cash: sum(rows, 'cash'),
            bank: sum(rows, 'bank'),
            kupan: sum(rows, 'kupan'),
            returnVal: sum(rows, 'returnVal'),
            adjust: sum(rows, 'adjust'),
            closing: sum(rows, 'closing'),
            pendingCount: pendingBills.length,
            pendingAmount: sum(pendingBills, 'amount'),
            openOrderCount: rows.reduce((s, r) => s + r.openOrders.length, 0),
        },
        failedParties: failed.length,
    };
};

export default { getDailyPartyHisab, todayIST };
