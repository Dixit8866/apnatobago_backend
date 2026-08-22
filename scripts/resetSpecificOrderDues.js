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
const { Order, User } = await import('../models/index.js');
import { Op } from 'sequelize';

async function main() {
    const args = process.argv.slice(2);
    const isExecute = args.includes('--execute') || args.includes('-e');

    // Filter out flag arguments to get targeted order IDs from CLI if provided
    const cliOrderIds = args.filter(arg => !arg.startsWith('-'));

    // Default target order IDs if none provided on command line
    const targetOrderIds = cliOrderIds.length > 0 ? cliOrderIds : ['27031'];

    console.log('======================================================================');
    console.log('            SPECIFIC ORDER DUE RESET SCRIPT                           ');
    console.log('======================================================================');
    console.log(`Mode: ${isExecute ? '⚠️ EXECUTE / COMMIT' : 'ℹ️ DRY RUN (No changes)'}`);
    console.log('Target Order IDs:', targetOrderIds.join(', '));
    console.log('Connecting to database...');

    await sequelize.authenticate();
    console.log('Database connected successfully.');

    const targetOrders = await Order.findAll({
        where: {
            orderId: targetOrderIds
        },
        attributes: ['id', 'orderId', 'userId', 'customerName', 'customerNumber', 'totalAmount', 'paidAmount', 'dueAmount', 'orderStatus', 'paymentStatus', 'notes', 'createdAt'],
        include: [{ model: User, as: 'user', attributes: ['id', 'fullname', 'number'] }],
        order: [['createdAt', 'DESC']]
    });

    console.log(`\nFound ${targetOrders.length} matching order(s) out of ${targetOrderIds.length} requested.`);

    if (targetOrders.length === 0) {
        console.log('❌ No matching orders found in the database. Exiting.');
        process.exit(0);
    }

    let totalDuesAmount = 0;
    console.log('\nTarget Orders Summary:');
    console.log('------------------------------------------------------------------------------------------------------------------');
    console.log('#   | Order ID       | Customer Name             | Phone          | Total Amt  | Due Amt    | Payment Status');
    console.log('------------------------------------------------------------------------------------------------------------------');
    targetOrders.forEach((o, index) => {
        const name = o.customerName || (o.user ? o.user.fullname : 'Direct Sale/Guest');
        const phone = o.customerNumber || (o.user ? o.user.number : 'N/A');
        const dueVal = parseFloat(o.dueAmount || 0);
        totalDuesAmount += dueVal;
        console.log(
            `${String(index + 1).padEnd(3)} | ${String(o.orderId).padEnd(14)} | ${name.padEnd(25).substring(0, 25)} | ${phone.padEnd(14)} | ₹${String(
                o.totalAmount
            ).padEnd(9)} | ₹${String(o.dueAmount).padEnd(9)} | ${o.paymentStatus}`
        );
    });
    console.log('------------------------------------------------------------------------------------------------------------------');
    console.log(`Summary: Total ${targetOrders.length} order(s) targeted. Total due amount to clear to 0: ₹${totalDuesAmount.toFixed(2)}`);
    console.log('------------------------------------------------------------------------------------------------------------------');

    if (!isExecute) {
        console.log('\n[DRY RUN SUMMARY] No changes have been written to the database.');
        console.log('To execute and set due amount to 0, run:');
        console.log(`    node scripts/resetSpecificOrderDues.js ${targetOrderIds.join(' ')} --execute`);
        console.log('======================================================================\n');
        process.exit(0);
    }

    console.log('\nExecuting database updates...');
    const t = await sequelize.transaction();

    try {
        let updatedCount = 0;
        for (const order of targetOrders) {
            const originalDue = parseFloat(order.dueAmount || 0);
            const originalPaid = parseFloat(order.paidAmount || 0);
            const total = parseFloat(order.totalAmount || 0);

            order.dueAmount = 0;
            order.paidAmount = total;
            order.paymentStatus = 'Paid';

            const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const scriptNote = `\n[Specific Due Reset Script - ${dateStr}]: Cleared outstanding due of ₹${originalDue.toFixed(2)} to 0. (Paid amount adjusted from ₹${originalPaid.toFixed(2)} to ₹${total.toFixed(2)}).`;
            order.notes = order.notes ? order.notes + scriptNote : scriptNote;

            await order.save({ transaction: t });
            updatedCount++;
        }

        await t.commit();
        console.log(`\n✅ Successfully updated ${updatedCount} order(s)! Outstanding due set to 0. ✓`);
        console.log('Transaction committed successfully.');
        console.log('======================================================================\n');
    } catch (error) {
        await t.rollback();
        console.error('\n❌ [Database Error] Transaction rolled back due to error:', error.message);
        throw error;
    } finally {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
});
