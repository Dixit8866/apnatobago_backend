import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

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

const { default: sequelize } = await import('../config/db.js');
const { 
    User, 
    Order, 
    OrderPayment, 
    PartyLedger, 
    PartyBalanceLog 
} = await import('../models/index.js');
import { Op } from 'sequelize';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * SCRIPT: Reset All Party Balances & Pending Dues (બધી પાર્ટીના જમા અને બાકી ઝીરો કરો)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This script resets:
 *   1. User balance fields: advanceJama = 0, creditline = 0, walletBalance = 0, balanceType = 'CLEAR'
 *   2. Order dues: dueAmount = 0, creditAmount = 0, paidAmount = totalAmount, paymentStatus = 'Paid'
 *   3. Removes dummy opening balance orders (KHATA-*)
 *   4. Removes CREDIT payment logs that cause fake pending dues
 *   5. Clears PartyLedger and PartyBalanceLog entries for clean fresh start
 *
 * Usage:
 *   Preview (Dry Run - No changes):
 *     node scripts/resetAllPartyBalancesAndDues.js
 *
 *   Execute for ALL Parties:
 *     node scripts/resetAllPartyBalancesAndDues.js --execute
 *     node scripts/resetAllPartyBalancesAndDues.js --all --execute
 *
 *   Execute for a SPECIFIC Party by Phone Number:
 *     node scripts/resetAllPartyBalancesAndDues.js --phone=9429089905 --execute
 *
 *   Execute for a SPECIFIC Party by User ID:
 *     node scripts/resetAllPartyBalancesAndDues.js --userId=UUID-HERE --execute
 * ─────────────────────────────────────────────────────────────────────────────
 */

async function main() {
    try {
        const args = process.argv.slice(2);
        const isDryRun = args.includes('--dry-run') || args.includes('--preview');
        const isExecute = !isDryRun && (
            args.includes('--execute') || 
            args.includes('-e') || 
            args.includes('--all') || 
            args.includes('--force') ||
            args.includes('--commit')
        );
        
        let targetPhone = null;
        let targetUserId = null;

        args.forEach(arg => {
            if (arg.startsWith('--phone=')) {
                targetPhone = arg.split('=')[1].replace(/\D/g, '').slice(-10);
            }
            if (arg.startsWith('--userId=')) {
                targetUserId = arg.split('=')[1].trim();
            }
        });

        console.log('\n======================================================================');
        console.log('    RESET ALL PARTY BALANCES & PENDING DUES (જમા અને બાકી ક્લીનર)     ');
        console.log('======================================================================');
        console.log(`Mode: ${isExecute ? '⚠️  EXECUTE / COMMIT (Database is being updated!)' : 'ℹ️  DRY RUN (Preview only, no changes made)'}`);

        await sequelize.authenticate();
        console.log('✅ Database connected successfully.\n');

        let userWhere = {};
        if (targetPhone) {
            userWhere = { number: { [Op.like]: `%${targetPhone}` } };
            console.log(`🎯 Targeting Specific Party Phone: %${targetPhone}`);
        } else if (targetUserId) {
            userWhere = { id: targetUserId };
            console.log(`🎯 Targeting Specific Party User ID: ${targetUserId}`);
        } else {
            console.log('🌐 Targeting ALL Parties across the system...');
        }

        // 1. Find matching users
        const users = await User.findAll({
            where: userWhere,
            attributes: ['id', 'fullname', 'number', 'creditline', 'advanceJama', 'walletBalance', 'balanceType']
        });

        console.log(`📋 Found ${users.length} party/user profile(s).`);

        const userIds = users.map(u => u.id);
        const userNumbers = users.map(u => String(u.number).replace(/\D/g, '').slice(-10)).filter(Boolean);

        // Calculate current balances before reset
        let totalCurrentJama = 0;
        let totalCurrentCreditline = 0;
        let totalCurrentWallet = 0;
        users.forEach(u => {
            totalCurrentJama += parseFloat(u.advanceJama || 0);
            totalCurrentCreditline += parseFloat(u.creditline || 0);
            totalCurrentWallet += parseFloat(u.walletBalance || 0);
        });

        // 2. Find matching orders with dues
        let orderWhere = {};
        if (targetPhone || targetUserId) {
            const orConds = [{ userId: { [Op.in]: userIds } }];
            if (userNumbers.length > 0) {
                orConds.push({
                    customerNumber: { [Op.or]: userNumbers.map(n => ({ [Op.like]: `%${n}` })) }
                });
            }
            orderWhere = { [Op.or]: orConds };
        }

        const ordersWithDue = await Order.findAll({
            where: {
                ...orderWhere,
                [Op.or]: [
                    { dueAmount: { [Op.gt]: 0 } },
                    { paymentStatus: { [Op.notIn]: ['Paid'] } }
                ]
            },
            attributes: ['id', 'orderId', 'userId', 'customerName', 'customerNumber', 'totalAmount', 'paidAmount', 'dueAmount', 'paymentStatus']
        });

        let totalOrderDues = 0;
        ordersWithDue.forEach(o => {
            totalOrderDues += parseFloat(o.dueAmount || 0);
        });

        // 3. Find dummy opening balance orders (KHATA-*)
        const khataOrders = await Order.findAll({
            where: {
                ...orderWhere,
                orderId: { [Op.like]: 'KHATA-%' }
            },
            attributes: ['id', 'orderId']
        });

        // 4. Count Ledger & BalanceLog entries
        const ledgerWhere = userIds.length > 0 && (targetPhone || targetUserId) ? { userId: { [Op.in]: userIds } } : {};
        const totalLedgerEntries = await PartyLedger.count({ where: ledgerWhere });
        const totalBalanceLogs = await PartyBalanceLog.count({ where: ledgerWhere });

        // Print Summary of items found
        console.log('\n─────────────────── CURRENT SUMMARY (BEFORE RESET) ───────────────────');
        console.log(`• Total Advance Jama (જમા રકમ):         ₹${totalCurrentJama.toLocaleString('en-IN')}`);
        console.log(`• Total Party Creditline (ક્રેડિટ બાકી):    ₹${totalCurrentCreditline.toLocaleString('en-IN')}`);
        console.log(`• Total Wallet Balance (વોલેટ જમા):       ₹${totalCurrentWallet.toLocaleString('en-IN')}`);
        console.log(`• Total Orders with Pending Due (ઓર્ડર બાકી): ${ordersWithDue.length} orders (₹${totalOrderDues.toLocaleString('en-IN')})`);
        console.log(`• Dummy KHATA Opening Orders:            ${khataOrders.length} orders`);
        console.log(`• Party Ledger Entries:                  ${totalLedgerEntries} records`);
        console.log(`• Party Balance Log Entries:             ${totalBalanceLogs} records`);
        console.log('──────────────────────────────────────────────────────────────────────\n');

        if (!isExecute) {
            console.log('ℹ️  DRY RUN COMPLETED. No database changes were made.');
            console.log('👉 To permanently CLEAR all jama & baki dues, run:');
            console.log(`   node scripts/resetAllPartyBalancesAndDues.js ${targetPhone ? `--phone=${targetPhone} ` : ''}${targetUserId ? `--userId=${targetUserId} ` : ''}--execute\n`);
            process.exit(0);
        }

        // =========================================================================
        // EXECUTE TRANSACTION
        // =========================================================================
        console.log('⏳ Executing database updates inside transaction...');
        const t = await sequelize.transaction();

        try {
            // 1. Reset all targeted Users
            if (userIds.length > 0) {
                await User.update({
                    advanceJama: 0,
                    creditline: 0,
                    walletBalance: 0,
                    balanceType: 'CLEAR'
                }, {
                    where: { id: { [Op.in]: userIds } },
                    transaction: t
                });
                console.log(`✅ Reset balance fields to 0 (CLEAR) for ${userIds.length} user(s).`);
            } else if (!targetPhone && !targetUserId) {
                await User.update({
                    advanceJama: 0,
                    creditline: 0,
                    walletBalance: 0,
                    balanceType: 'CLEAR'
                }, {
                    where: {},
                    transaction: t
                });
                console.log('✅ Reset balance fields to 0 (CLEAR) for ALL users.');
            }

            // 2. Destroy dummy KHATA orders
            if (khataOrders.length > 0) {
                const khataOrderIds = khataOrders.map(k => k.id);
                await Order.destroy({
                    where: { id: { [Op.in]: khataOrderIds } },
                    force: true,
                    transaction: t
                });
                console.log(`✅ Deleted ${khataOrders.length} dummy KHATA opening order(s).`);
            }

            // 3. Reset Order Dues & set paidAmount = totalAmount, paymentStatus = Paid
            const targetOrderIds = ordersWithDue.map(o => o.id);
            if (targetOrderIds.length > 0) {
                // Delete old CREDIT payment entries on these orders to prevent phantom dues
                await OrderPayment.destroy({
                    where: {
                        orderId: { [Op.in]: targetOrderIds },
                        paymentMethod: 'CREDIT'
                    },
                    force: true,
                    transaction: t
                });

                // Update orders to fully cleared
                for (const ord of ordersWithDue) {
                    const total = parseFloat(ord.totalAmount || 0);
                    await Order.update({
                        dueAmount: 0,
                        paidAmount: total,
                        paymentStatus: 'Paid',
                        deliveryNotice: null
                    }, {
                        where: { id: ord.id },
                        transaction: t
                    });
                }
                console.log(`✅ Cleared pending dues for ${ordersWithDue.length} order(s) (Marked as Paid).`);
            }

            // 4. Delete PartyLedger records for clean slate
            const deletedLedgers = await PartyLedger.destroy({
                where: ledgerWhere,
                force: true,
                transaction: t
            });
            console.log(`✅ Cleared ${deletedLedgers} PartyLedger entry/entries.`);

            // 5. Delete PartyBalanceLog records
            const deletedLogs = await PartyBalanceLog.destroy({
                where: ledgerWhere,
                force: true,
                transaction: t
            });
            console.log(`✅ Cleared ${deletedLogs} PartyBalanceLog entry/entries.`);

            // Commit all changes
            await t.commit();

            console.log('\n======================================================================');
            console.log('🎉 SUCCESS: ALL JAMA AND BAKI DUES HAVE BEEN SUCCESSFULLY CLEARED! 🎉');
            console.log('======================================================================');
            console.log('All parties now have:');
            console.log('  • Jama Amount (જમા રકમ):       ₹0.00');
            console.log('  • Baki Pending Due (બાકી રકમ):  ₹0.00');
            console.log('  • Balance Status:              CLEAR');
            console.log('======================================================================\n');

            process.exit(0);
        } catch (innerErr) {
            await t.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error('\n❌ Error executing balance reset script:', err.message);
        process.exit(1);
    }
}

main();
