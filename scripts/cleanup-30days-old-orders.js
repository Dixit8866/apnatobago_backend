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
    OrderPayment, 
    OrderAssignment, 
    SalesReturn, 
    PartyBalanceLog,
    PartyLedger,
    OutletOrder,
    OutletOrderItem
} = await import('../models/index.js');
import { Op } from 'sequelize';

/**
 * =========================================================================================
 * PRODUCTION-GRADE 30-DAY OLD ORDER CLEANUP SCRIPT
 * =========================================================================================
 * 
 * Safely purges historical orders and all cascade relations created before a given cutoff date.
 * 
 * Features:
 *  - 🛡️ Safe by Default: Runs in DRY RUN mode unless `--confirm` is explicitly passed.
 *  - 🔄 Batch Deletions: Deletes in configurable chunks (default: 500) within database transactions
 *       to prevent table locks, memory issues, or timeouts in production PostgreSQL.
 *  - 🔗 Complete Cascade: Purges child records in strict reverse foreign-key order:
 *       1. order_items
 *       2. order_payments
 *       3. order_assignments
 *       4. sales_returns
 *       5. party_balance_logs
 *       6. party_ledgers (or sets orderId = NULL if --preserve-ledger is provided)
 *       7. orders (force: true, bypassing soft delete paranoid mode)
 *  - 🏪 Optional Outlet Orders: Purges outlet_orders & outlet_order_items if `--include-outlets` is set.
 * 
 * Usage Examples:
 *   # 1. Dry run (Scan database and report counts, NO data deleted)
 *   node scripts/cleanup-30days-old-orders.js
 * 
 *   # 2. Permanent deletion (Production Execute)
 *   node scripts/cleanup-30days-old-orders.js --confirm
 * 
 *   # 3. Specify custom cutoff date (e.g. before 03-09-2026)
 *   node scripts/cleanup-30days-old-orders.js --cutoff=2026-09-03 --confirm
 * 
 *   # 4. Specify custom number of days (e.g. 30 days)
 *   node scripts/cleanup-30days-old-orders.js --days=30 --confirm
 * 
 *   # 5. Include Outlet Orders as well
 *   node scripts/cleanup-30days-old-orders.js --include-outlets --confirm
 * 
 *   # 6. Preserve ledger financial entries (unlink orderId instead of deleting ledger rows)
 *   node scripts/cleanup-30days-old-orders.js --preserve-ledger --confirm
 * =========================================================================================
 */

async function runCleanup() {
    console.log('\n===================================================================================');
    console.log('       🔥 APNA TOBACCO - 30+ DAYS OLD ORDERS CLEANUP SCRIPT (PRODUCTION SAFE)      ');
    console.log('===================================================================================\n');

    try {
        await sequelize.authenticate();
        console.log('✅ Connected to PostgreSQL database successfully.\n');

        // CLI Arguments
        const args = process.argv.slice(2);
        const isConfirm = args.includes('--confirm') || args.includes('--execute') || args.includes('-e') || args.includes('--force');
        const includeOutlets = args.includes('--include-outlets');
        const preserveLedger = args.includes('--preserve-ledger');

        // Batch Size
        let batchSize = 500;
        const batchArg = args.find(a => a.startsWith('--batch=') || a.startsWith('--batch-size='));
        if (batchArg) {
            const parsedBatch = parseInt(batchArg.split('=')[1], 10);
            if (!isNaN(parsedBatch) && parsedBatch > 0) batchSize = parsedBatch;
        }

        // Determine Cutoff Date
        let cutoffDate;
        const cutoffArg = args.find(a => a.startsWith('--cutoff=') || a.startsWith('--date='));
        const daysArg = args.find(a => a.startsWith('--days='));

        if (cutoffArg) {
            const raw = cutoffArg.split('=')[1].trim();
            cutoffDate = new Date(raw.length === 10 ? `${raw}T00:00:00+05:30` : raw);
        } else if (daysArg) {
            const days = parseInt(daysArg.split('=')[1], 10);
            cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        } else {
            // Default target date: 03-09-2026 (or 30 days prior to now)
            const targetExplicit = new Date('2026-09-03T00:00:00+05:30');
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            cutoffDate = Math.abs(Date.now() - new Date('2026-10-03T00:00:00+05:30').getTime()) < 14 * 86400000 
                ? targetExplicit 
                : thirtyDaysAgo;
        }

        if (isNaN(cutoffDate.getTime())) {
            console.error('❌ Invalid cutoff date specified. Format must be YYYY-MM-DD.');
            process.exit(1);
        }

        const istCutoff = cutoffDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium' });
        const utcCutoff = cutoffDate.toISOString();

        console.log(`📌 Cutoff Date: ${istCutoff} (IST)`);
        console.log(`📌 Cutoff ISO:  ${utcCutoff} (UTC)`);
        console.log(`📌 Mode:         ${isConfirm ? '🚨 PERMANENT EXECUTE / DELETE (Data WILL be removed)' : 'ℹ️ DRY RUN ONLY (No changes will be made)'}`);
        console.log(`📌 Batch Size:   ${batchSize} orders per transaction`);
        console.log(`📌 Outlets:      ${includeOutlets ? 'Include Outlet Orders' : 'User Orders Only'}`);
        console.log(`📌 Ledger Mode:  ${preserveLedger ? 'Preserve Ledger (Unlink orderId)' : 'Delete corresponding Ledger rows'}\n`);

        // Query User Orders older than cutoff
        const orderWhere = {
            createdAt: {
                [Op.lt]: cutoffDate
            }
        };

        const totalOrders = await Order.count({
            where: orderWhere,
            paranoid: false
        });

        console.log(`🔍 Total User Orders found older than cutoff: ${totalOrders}`);

        if (totalOrders === 0) {
            console.log('✨ No user orders found matching the cutoff criteria. Database is already clean!\n');
        } else {
            // Fetch date range of matching orders
            const oldestOrder = await Order.findOne({
                where: orderWhere,
                order: [['createdAt', 'ASC']],
                attributes: ['id', 'orderId', 'createdAt', 'orderStatus', 'totalAmount'],
                paranoid: false
            });

            const newestOrder = await Order.findOne({
                where: orderWhere,
                order: [['createdAt', 'DESC']],
                attributes: ['id', 'orderId', 'createdAt', 'orderStatus', 'totalAmount'],
                paranoid: false
            });

            const totalRevenue = await Order.sum('totalAmount', {
                where: orderWhere,
                paranoid: false
            }) || 0;

            console.log(`   - Oldest order: #${oldestOrder?.orderId || oldestOrder?.id} on ${oldestOrder?.createdAt?.toISOString()}`);
            console.log(`   - Newest order: #${newestOrder?.orderId || newestOrder?.id} on ${newestOrder?.createdAt?.toISOString()}`);
            console.log(`   - Total Order Value: ₹${Number(totalRevenue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);

            // Check counts of child records across entire matching set
            console.log('\n📊 Calculating cascade records to be cleaned...');

            const [itemsCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM order_items 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const [paymentsCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM order_payments 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const [assignmentsCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM order_assignments 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const [returnsCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM sales_returns 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const [balanceLogsCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM party_balance_logs 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const [ledgersCountResult] = await sequelize.query(`
                SELECT count(*)::int as count 
                FROM party_ledgers 
                WHERE "orderId" IN (SELECT id FROM orders WHERE "createdAt" < :cutoff)
            `, { replacements: { cutoff: cutoffDate } });

            const childStats = {
                items: itemsCountResult[0]?.count || 0,
                payments: paymentsCountResult[0]?.count || 0,
                assignments: assignmentsCountResult[0]?.count || 0,
                returns: returnsCountResult[0]?.count || 0,
                balanceLogs: balanceLogsCountResult[0]?.count || 0,
                ledgers: ledgersCountResult[0]?.count || 0
            };

            console.log(`   - Order Items:          ${childStats.items}`);
            console.log(`   - Order Payments:       ${childStats.payments}`);
            console.log(`   - Order Assignments:    ${childStats.assignments}`);
            console.log(`   - Sales Returns:        ${childStats.returns}`);
            console.log(`   - Party Balance Logs:   ${childStats.balanceLogs}`);
            console.log(`   - Party Ledger Entries: ${childStats.ledgers} (${preserveLedger ? 'will unlink' : 'will delete'})\n`);
        }

        // Outlet Orders (if requested)
        let totalOutletOrders = 0;
        if (includeOutlets) {
            totalOutletOrders = await OutletOrder.count({
                where: orderWhere,
                paranoid: false
            });
            console.log(`🏪 Total Outlet Orders found older than cutoff: ${totalOutletOrders}\n`);
        }

        // DRY RUN EXIT
        if (!isConfirm) {
            console.log('===================================================================================');
            console.log('ℹ️  DRY RUN COMPLETED SUCCESSFULLY! No records were modified or deleted.');
            console.log('-----------------------------------------------------------------------------------');
            console.log('To permanently clear all old orders from the database, run:');
            console.log('   node scripts/cleanup-30days-old-orders.js --confirm\n');
            console.log('Optional parameters:');
            console.log('   --cutoff=2026-09-03       (Specify explicit cutoff date YYYY-MM-DD)');
            console.log('   --days=30                 (Purge orders older than N days)');
            console.log('   --include-outlets         (Also purge outlet orders)');
            console.log('   --preserve-ledger         (Unlink orderId on ledger instead of deleting rows)');
            console.log('   --batch=500               (Number of records per transaction)');
            console.log('===================================================================================\n');
            process.exit(0);
        }

        // 3. EXECUTION MODE (--confirm passed)
        console.log('🚨 COMMENCING PRODUCTION DELETION IN TRANSACTIONS...\n');

        let deletedOrdersTotal = 0;
        let deletedItemsTotal = 0;
        let deletedPaymentsTotal = 0;
        let deletedAssignmentsTotal = 0;
        let deletedReturnsTotal = 0;
        let deletedBalanceLogsTotal = 0;
        let handledLedgersTotal = 0;

        const startTime = Date.now();

        // Process User Orders in Batches
        let hasMore = totalOrders > 0;
        let batchIndex = 0;
        const totalBatches = Math.ceil(totalOrders / batchSize);

        while (hasMore) {
            batchIndex++;

            // Fetch a batch of Order IDs
            const batchOrders = await Order.findAll({
                where: orderWhere,
                attributes: ['id', 'orderId'],
                limit: batchSize,
                paranoid: false
            });

            if (batchOrders.length === 0) {
                hasMore = false;
                break;
            }

            const batchIds = batchOrders.map(o => o.id);
            const t = await sequelize.transaction();

            try {
                // Step A: Delete Order Items
                const deletedItems = await OrderItem.destroy({
                    where: { orderId: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedItemsTotal += deletedItems;

                // Step B: Delete Order Payments
                const deletedPayments = await OrderPayment.destroy({
                    where: { orderId: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedPaymentsTotal += deletedPayments;

                // Step C: Delete Order Assignments
                const deletedAssignments = await OrderAssignment.destroy({
                    where: { orderId: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedAssignmentsTotal += deletedAssignments;

                // Step D: Delete Sales Returns linked to these orders
                const deletedReturns = await SalesReturn.destroy({
                    where: { orderId: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedReturnsTotal += deletedReturns;

                // Step E: Handle Party Balance Logs
                const deletedBalanceLogs = await PartyBalanceLog.destroy({
                    where: { orderId: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedBalanceLogsTotal += deletedBalanceLogs;

                // Step F: Handle Party Ledgers
                if (preserveLedger) {
                    const [updatedLedgers] = await PartyLedger.update(
                        { orderId: null },
                        { where: { orderId: { [Op.in]: batchIds } }, transaction: t }
                    );
                    handledLedgersTotal += updatedLedgers;
                } else {
                    const deletedLedgers = await PartyLedger.destroy({
                        where: { orderId: { [Op.in]: batchIds } },
                        force: true,
                        transaction: t
                    });
                    handledLedgersTotal += deletedLedgers;
                }

                // Step G: Delete the Orders themselves
                const deletedOrders = await Order.destroy({
                    where: { id: { [Op.in]: batchIds } },
                    force: true,
                    transaction: t
                });
                deletedOrdersTotal += deletedOrders;

                await t.commit();

                console.log(`   [Batch ${batchIndex}/${totalBatches || 1}] Cleared ${deletedOrders} orders (Items: ${deletedItems}, Payments: ${deletedPayments}, Returns: ${deletedReturns}, Ledgers: ${handledLedgersTotal})`);

                if (batchOrders.length < batchSize) {
                    hasMore = false;
                }
            } catch (batchErr) {
                await t.rollback();
                console.error(`\n❌ Error during Batch ${batchIndex}:`, batchErr.message);
                throw batchErr;
            }
        }

        // Handle Outlet Orders if requested
        let deletedOutletOrdersTotal = 0;
        let deletedOutletItemsTotal = 0;

        if (includeOutlets && totalOutletOrders > 0) {
            console.log('\n🏪 Processing Outlet Orders cleanup...');
            let hasMoreOutlet = true;
            let outletBatchIndex = 0;

            while (hasMoreOutlet) {
                outletBatchIndex++;
                const batchOutlets = await OutletOrder.findAll({
                    where: orderWhere,
                    attributes: ['id'],
                    limit: batchSize,
                    paranoid: false
                });

                if (batchOutlets.length === 0) {
                    hasMoreOutlet = false;
                    break;
                }

                const batchOutletIds = batchOutlets.map(o => o.id);
                const tOutlet = await sequelize.transaction();

                try {
                    const deletedOItems = await OutletOrderItem.destroy({
                        where: { outletOrderId: { [Op.in]: batchOutletIds } },
                        force: true,
                        transaction: tOutlet
                    });
                    deletedOutletItemsTotal += deletedOItems;

                    const deletedOOrders = await OutletOrder.destroy({
                        where: { id: { [Op.in]: batchOutletIds } },
                        force: true,
                        transaction: tOutlet
                    });
                    deletedOutletOrdersTotal += deletedOOrders;

                    await tOutlet.commit();
                    console.log(`   [Outlet Batch ${outletBatchIndex}] Cleared ${deletedOOrders} outlet orders (${deletedOItems} items)`);

                    if (batchOutlets.length < batchSize) {
                        hasMoreOutlet = false;
                    }
                } catch (outletErr) {
                    await tOutlet.rollback();
                    console.error(`\n❌ Error during Outlet Batch ${outletBatchIndex}:`, outletErr.message);
                    throw outletErr;
                }
            }
        }

        const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

        console.log('\n===================================================================================');
        console.log('🎉 CLEANUP EXECUTION COMPLETE - DATABASE PURGE SUCCESSFUL!');
        console.log('===================================================================================');
        console.log(`⏱️  Elapsed Time:             ${elapsedSeconds} seconds`);
        console.log(`📦 Orders Deleted:            ${deletedOrdersTotal}`);
        console.log(`🛍️  Order Items Deleted:       ${deletedItemsTotal}`);
        console.log(`💳 Payments Deleted:          ${deletedPaymentsTotal}`);
        console.log(`🚚 Assignments Deleted:       ${deletedAssignmentsTotal}`);
        console.log(`↩️  Sales Returns Deleted:     ${deletedReturnsTotal}`);
        console.log(`📋 Balance Logs Deleted:      ${deletedBalanceLogsTotal}`);
        console.log(`📒 Ledger Records Handled:    ${handledLedgersTotal} (${preserveLedger ? 'Unlinked' : 'Deleted'})`);
        if (includeOutlets) {
            console.log(`🏪 Outlet Orders Deleted:     ${deletedOutletOrdersTotal}`);
            console.log(`🏷️  Outlet Items Deleted:      ${deletedOutletItemsTotal}`);
        }
        console.log('===================================================================================\n');

        process.exit(0);
    } catch (err) {
        console.error('\n❌ Fatal error executing cleanup script:', err);
        process.exit(1);
    }
}

runCleanup();
