import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SCRIPT: Reset every party's balance to 0 (બધી પાર્ટીનું બાકી / જમા ઝીરો)
 * ─────────────────────────────────────────────────────────────────────────────
 * Production safe:
 *   • NO order, payment or sales return is deleted or edited. Old bills stay as they are in the Party Ledger.
 *   • Per party one "Balance Reset" line is added (PartyBalanceLog BALANCE_RESET): opening X -> closing 0.
 *     It is not counted as cash or sales.
 *   • Bills not payment-verified yet are placed after the reset line (BALANCE_RESET_CARRY), so they open at 0.
 *   • Bills delivered but not verified (Delivered / Payment Collect) are written off too (BALANCE_RESET_WRITEOFF):
 *     their own baki / jama stays 0 even after they are verified.
 *   • user.advanceJama = 0, balanceType = CLEAR; closingBalance and bill dues are re-synced from the Party Ledger.
 *   • Credit limit (creditline), wallet and the party's opening balance setting are NOT touched.
 *   • Each party runs in its own transaction. Every change is written to a backup file so --undo restores it.
 *
 * Usage (run from backend/):
 *   Preview only (no changes):   node scripts/resetPartyBalancesToZero.js
 *   One party first:             node scripts/resetPartyBalancesToZero.js --phone=9429089905 --execute
 *   All parties:                 node scripts/resetPartyBalancesToZero.js --execute
 *   Undo a run (preview / do):   node scripts/resetPartyBalancesToZero.js --undo=scripts/backups/balance-reset-<runId>.json [--execute]
 * ─────────────────────────────────────────────────────────────────────────────
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendRoot = join(__dirname, '..');
const envPath = join(backendRoot, '.env');
const envProdPath = join(backendRoot, '.env.production');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else if (fs.existsSync(envProdPath)) {
    dotenv.config({ path: envProdPath });
} else {
    dotenv.config();
}

const args = process.argv.slice(2);
const getArg = (name) => {
    const found = args.find(a => a.startsWith(`--${name}=`));
    return found ? found.slice(name.length + 3).trim() : null;
};
const EXECUTE = args.includes('--execute');
const UNDO_FILE = getArg('undo');
const TARGET_PHONE = getArg('phone') ? getArg('phone').replace(/\D/g, '').slice(-10) : null;
const TARGET_USER_ID = getArg('userId');

// models/index.js runs schema migrations when imported: wait for them before opening transactions
let migrationsDone;
const migrationsReady = new Promise(resolve => { migrationsDone = resolve; });
const origLog = console.log;
const origError = console.error;
console.log = (...a) => { if (String(a[0] ?? '').includes('DB schema updates applied')) migrationsDone(); origLog(...a); };
console.error = (...a) => { if (String(a[0] ?? '').includes('[Migration Error]')) migrationsDone(); origError(...a); };

const { default: sequelize } = await import('../config/db.js');
const { User, Order, PartyBalanceLog } = await import('../models/index.js');
const {
    syncPartyLedger,
    BALANCE_RESET,
    BALANCE_RESET_CARRY,
    BALANCE_RESET_WRITEOFF
} = await import('../services/partyLedger.service.js');
const { Op } = await import('sequelize');

await Promise.race([migrationsReady, new Promise(resolve => setTimeout(resolve, 120000))]);
console.log = origLog;
console.error = origError;

const SCRIPT_NAME = 'Balance Reset Script';
// Delivered but payment not verified: own baki / jama written off
const WRITEOFF_STATUSES = ['delivered', 'payment collect'];

const round2 = (v) => parseFloat((parseFloat(v || 0)).toFixed(2));
const fmtBal = (v) => {
    const n = round2(v);
    if (Math.abs(n) < 0.01) return '₹0.00';
    return `₹${Math.abs(n).toFixed(2)} ${n > 0 ? 'CR (baki)' : 'DR (jama)'}`;
};

/**
 * What the reset does for one party, read inside `transaction`.
 */
const planParty = async (user, transaction) => {
    const ledger = await syncPartyLedger(user.id, { persist: false, transaction });
    const rows = ledger.ledgerRows || [];
    const balance = round2(ledger.closingBalance);

    const unverifiedRows = rows.filter(r => r.orderId && !r.isPaymentVerified);
    const unverifiedOrders = unverifiedRows.length > 0
        ? await Order.findAll({
            where: { id: unverifiedRows.map(r => r.orderId) },
            attributes: ['id', 'orderId', 'orderStatus'],
            transaction
        })
        : [];
    const writeOffOrders = unverifiedOrders.filter(o => WRITEOFF_STATUSES.includes(String(o.orderStatus || '').toLowerCase()));
    const carryOrders = unverifiedOrders.filter(o => !WRITEOFF_STATUSES.includes(String(o.orderStatus || '').toLowerCase()));

    const advanceJama = round2(user.advanceJama);
    const needsReset = Math.abs(balance) >= 0.01 || writeOffOrders.length > 0;
    const needsUserClean = advanceJama !== 0 || (user.balanceType && user.balanceType !== 'CLEAR');

    return {
        rows,
        balance,
        writeOffOrders,
        carryOrders,
        advanceJama,
        needsReset,
        needsUserClean,
        hasWork: needsReset || needsUserClean
    };
};

const runReset = async () => {
    const runId = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
    const backupDir = join(__dirname, 'backups');
    const backupFile = join(backupDir, `balance-reset-${runId}.json`);
    const backup = { runId, startedAt: new Date().toISOString(), parties: [], failed: [] };
    const writeBackup = () => fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));

    const userWhere = TARGET_PHONE
        ? { number: { [Op.like]: `%${TARGET_PHONE}` } }
        : (TARGET_USER_ID ? { id: TARGET_USER_ID } : {});
    const users = await User.findAll({
        where: userWhere,
        attributes: ['id', 'fullname', 'number', 'advanceJama', 'balanceType', 'closingBalance'],
        order: [['createdAt', 'ASC']]
    });

    console.log(`\nMode: ${EXECUTE ? 'EXECUTE (database will be updated)' : 'PREVIEW (no changes)'}`);
    console.log(`Parties: ${users.length}${TARGET_PHONE ? ` (phone %${TARGET_PHONE})` : ''}${TARGET_USER_ID ? ` (userId ${TARGET_USER_ID})` : ''}\n`);

    if (EXECUTE) {
        fs.mkdirSync(backupDir, { recursive: true });
        writeBackup();
        console.log(`Backup file: ${backupFile}\n`);
    }

    let totalCr = 0;
    let totalDr = 0;
    let partiesChanged = 0;
    let writeOffCount = 0;

    for (const user of users) {
        const label = `${user.fullname || 'Party'} (${user.number || '-'})`;
        const t = EXECUTE ? await sequelize.transaction() : null;
        try {
            const plan = await planParty(user, t);
            if (!plan.hasWork) {
                if (t) await t.rollback();
                continue;
            }

            partiesChanged++;
            if (plan.balance > 0) totalCr += plan.balance;
            if (plan.balance < 0) totalDr += Math.abs(plan.balance);
            writeOffCount += plan.writeOffOrders.length;

            console.log(`• ${label}: balance ${fmtBal(plan.balance)} -> ₹0.00`
                + (plan.writeOffOrders.length ? ` | write off unverified delivered bills: ${plan.writeOffOrders.map(o => o.orderId).join(', ')}` : '')
                + (plan.carryOrders.length ? ` | bills kept after reset: ${plan.carryOrders.length}` : '')
                + (plan.advanceJama !== 0 ? ` | advanceJama ${plan.advanceJama} -> 0` : ''));

            if (!EXECUTE) continue;

            // Backup before any change
            const verifiedOrderIds = plan.rows.filter(r => r.orderId && r.isPaymentVerified).map(r => r.orderId);
            const ordersBefore = verifiedOrderIds.length > 0
                ? await Order.findAll({ where: { id: verifiedOrderIds }, attributes: ['id', 'dueAmount', 'paymentStatus'], transaction: t })
                : [];
            const partyBackup = {
                userId: user.id,
                name: label,
                balanceBefore: plan.balance,
                userBefore: {
                    closingBalance: user.closingBalance,
                    advanceJama: user.advanceJama,
                    balanceType: user.balanceType
                },
                ordersBefore: ordersBefore.map(o => ({ id: o.id, dueAmount: o.dueAmount, paymentStatus: o.paymentStatus })),
                logIds: []
            };

            if (plan.needsReset) {
                const resetAt = new Date();
                const resetLog = await PartyBalanceLog.create({
                    userId: user.id,
                    orderId: null,
                    type: BALANCE_RESET,
                    amount: 0,
                    previousBalance: plan.balance,
                    newBalance: 0,
                    note: `Balance reset to 0 by script (run ${runId}), was ${fmtBal(plan.balance)}`,
                    createdByName: SCRIPT_NAME,
                    createdAt: resetAt,
                    updatedAt: resetAt
                }, { transaction: t });
                partyBackup.logIds.push(resetLog.id);

                const markers = [
                    ...plan.carryOrders.map(o => ({ order: o, type: BALANCE_RESET_CARRY, note: 'bill kept after reset' })),
                    ...plan.writeOffOrders.map(o => ({ order: o, type: BALANCE_RESET_WRITEOFF, note: "bill's own baki / jama written off" }))
                ];
                for (const m of markers) {
                    const markerLog = await PartyBalanceLog.create({
                        userId: user.id,
                        orderId: m.order.id,
                        type: m.type,
                        amount: 0,
                        previousBalance: 0,
                        newBalance: 0,
                        note: `Balance reset (run ${runId}): #${m.order.orderId} ${m.note}`,
                        createdByName: SCRIPT_NAME,
                        createdAt: resetAt,
                        updatedAt: resetAt
                    }, { transaction: t });
                    partyBackup.logIds.push(markerLog.id);
                }
            }

            await User.update({ advanceJama: 0, balanceType: 'CLEAR' }, { where: { id: user.id }, transaction: t });

            // Re-sync closingBalance and bill dues from the ledger, and confirm the party is now at 0
            const after = await syncPartyLedger(user.id, { transaction: t });
            if (Math.abs(round2(after.closingBalance)) >= 0.01) {
                throw new Error(`closing after reset is ${after.closingBalance}, expected 0`);
            }

            await t.commit();
            backup.parties.push(partyBackup);
            writeBackup();
        } catch (err) {
            if (t && !t.finished) await t.rollback();
            console.error(`  ✗ ${label}: ${err.message} (nothing changed for this party)`);
            if (EXECUTE) {
                backup.failed.push({ userId: user.id, name: label, error: err.message });
                writeBackup();
            }
        }
    }

    console.log('\n──────────────────────────── SUMMARY ────────────────────────────');
    console.log(`Parties ${EXECUTE ? 'reset' : 'to reset'}: ${EXECUTE ? backup.parties.length : partiesChanged}`);
    console.log(`Baki (CR) cleared:  ₹${totalCr.toFixed(2)}`);
    console.log(`Jama (DR) cleared:  ₹${totalDr.toFixed(2)}`);
    console.log(`Unverified delivered bills written off: ${writeOffCount}`);
    if (EXECUTE) {
        backup.finishedAt = new Date().toISOString();
        writeBackup();
        console.log(`Failed parties: ${backup.failed.length}`);
        console.log(`Backup / undo file: ${backupFile}`);
        console.log(`Undo: node scripts/resetPartyBalancesToZero.js --undo=${join('scripts', 'backups', `balance-reset-${runId}.json`)} --execute`);
    } else {
        console.log('\nPreview only. Run with --execute to apply (try one party first with --phone=...).');
    }
};

const runUndo = async () => {
    const backup = JSON.parse(fs.readFileSync(UNDO_FILE, 'utf8'));
    console.log(`\nMode: ${EXECUTE ? 'UNDO EXECUTE (database will be restored)' : 'UNDO PREVIEW (no changes)'}`);
    console.log(`Run ${backup.runId}: ${backup.parties.length} parties\n`);

    let restored = 0;
    for (const p of backup.parties) {
        console.log(`• ${p.name}: remove ${p.logIds.length} reset entr${p.logIds.length === 1 ? 'y' : 'ies'}, balance back to ${fmtBal(p.balanceBefore)}`);
        if (!EXECUTE) continue;

        const t = await sequelize.transaction();
        try {
            await PartyBalanceLog.destroy({ where: { id: p.logIds, userId: p.userId }, transaction: t });
            await syncPartyLedger(p.userId, { transaction: t });
            // Put back exactly what was there before the run
            await User.update({
                closingBalance: p.userBefore.closingBalance,
                advanceJama: p.userBefore.advanceJama,
                balanceType: p.userBefore.balanceType
            }, { where: { id: p.userId }, transaction: t });
            for (const o of p.ordersBefore) {
                await Order.update({ dueAmount: o.dueAmount, paymentStatus: o.paymentStatus }, { where: { id: o.id }, transaction: t });
            }
            await t.commit();
            restored++;
        } catch (err) {
            if (!t.finished) await t.rollback();
            console.error(`  ✗ ${p.name}: ${err.message} (nothing changed for this party)`);
        }
    }

    console.log(EXECUTE ? `\nRestored parties: ${restored}/${backup.parties.length}` : '\nPreview only. Add --execute to undo.');
};

try {
    await sequelize.authenticate();
    if (UNDO_FILE) {
        await runUndo();
    } else {
        await runReset();
    }
    await sequelize.close();
    process.exit(0);
} catch (err) {
    console.error('\n❌ Balance reset script failed:', err.message);
    process.exit(1);
}
