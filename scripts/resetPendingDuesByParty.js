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
    
    // Extract target user IDs from command line arguments (ignoring execution flags)
    let targetUserIds = args.filter(arg => arg !== '--execute' && arg !== '-e');

    // Default user IDs provided by user if none passed in arguments
    const defaultUserIds = [
        '7ce3e914-819e-44a1-a115-1c451640400a',
        '9983a734-5a41-4e30-83de-96e826e084ad'
    ];

    if (targetUserIds.length === 0) {
        targetUserIds = defaultUserIds;
    }

    console.log('======================================================================');
    console.log('             PARTY-SPECIFIC PENDING DUE RESET SCRIPT                  ');
    console.log('======================================================================');
    console.log(`Running in mode: ${isExecute ? '⚠️ EXECUTE / COMMIT' : 'ℹ️ DRY RUN (No changes)'}`);
    console.log('Target Party/User IDs:');
    targetUserIds.forEach((id, idx) => console.log(`  ${idx + 1}. ${id}`));
    console.log('----------------------------------------------------------------------');
    console.log('Connecting to database...');

    await sequelize.authenticate();
    console.log('Database connected successfully.');

    // Find details about the users/parties first
    const targetUsers = await User.findAll({
        where: { id: targetUserIds }
    });

    console.log(`\nFound ${targetUsers.length} of ${targetUserIds.length} target parties in the database:`);
    targetUsers.forEach((user, idx) => {
        console.log(`  - Party: ${user.fullname || 'N/A'} | Number: ${user.number || 'N/A'} | ID: ${user.id}`);
    });

    // DIAGNOSTIC: Find ALL orders for these users to see what exists in the database
    console.log('\n--- DIAGNOSTIC: Listing ALL orders for these parties in the database ---');
    const allOrders = await Order.findAll({
        where: { userId: targetUserIds },
        include: [{ model: User, as: 'user' }],
        order: [['createdAt', 'DESC']]
    });

    if (allOrders.length === 0) {
        console.log('No orders of any status found for these party IDs in the database.');
        process.exit(0);
    }

    console.log(
        '#   | Order ID       | Customer Name             | Total Amt  | Due Amt    | Paid Amt   | Status            | Payment Status'
    );
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    allOrders.forEach((o, index) => {
        const name = o.customerName || (o.user ? o.user.fullname : 'Direct Sale/Guest');
        console.log(
            `${String(index + 1).padEnd(3)} | ${String(o.orderId).padEnd(14)} | ${name.padEnd(25).substring(0, 25)} | ₹${String(
                o.totalAmount
            ).padEnd(9)} | ₹${String(o.dueAmount).padEnd(9)} | ₹${String(o.paidAmount || 0).padEnd(9)} | ${o.orderStatus.padEnd(17)} | ${o.paymentStatus}`
        );
    });
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');

    // Filter orders that have dueAmount > 0 and orderStatus !== 'Cancelled'
    // We match getProfile logic which only filters out 'Cancelled' to ensure the app's display is updated to 0
    const eligibleOrders = allOrders.filter(o => {
        const dueVal = parseFloat(o.dueAmount);
        return dueVal > 0 && o.orderStatus !== 'Cancelled';
    });

    console.log(`\nFound ${eligibleOrders.length} eligible orders with pending dues (dueAmount > 0 and status is not 'Cancelled').`);

    if (eligibleOrders.length === 0) {
        console.log('No eligible orders found to update. Exiting.');
        process.exit(0);
    }

    let totalDuesAmount = 0;
    console.log('\nList of orders to reset to 0 due:');
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    console.log(
        '#   | Order ID       | Customer Name             | Total Amt  | Due Amt    | Status            | Created At'
    );
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    eligibleOrders.forEach((o, index) => {
        const name = o.customerName || (o.user ? o.user.fullname : 'Direct Sale/Guest');
        const dueVal = parseFloat(o.dueAmount);
        totalDuesAmount += dueVal;
        console.log(
            `${String(index + 1).padEnd(3)} | ${String(o.orderId).padEnd(14)} | ${name.padEnd(25).substring(0, 25)} | ₹${String(
                o.totalAmount
            ).padEnd(9)} | ₹${String(o.dueAmount).padEnd(9)} | ${o.orderStatus.padEnd(17)} | ${new Date(o.createdAt).toLocaleDateString()}`
        );
    });
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    console.log(`Summary: Total ${eligibleOrders.length} orders will be modified. Total due amount to zero out: ₹${totalDuesAmount.toFixed(2)}`);
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');

    if (!isExecute) {
        console.log('\n[DRY RUN SUMMARY] No changes have been written to the database.');
        console.log('To apply these changes, run the script with the execution flag:');
        console.log('    node scripts/resetPendingDuesByParty.js --execute');
        console.log('======================================================================\n');
        process.exit(0);
    }

    console.log('\nExecuting database updates (NO delete operations)...');
    const t = await sequelize.transaction();

    try {
        let updatedCount = 0;
        for (const order of eligibleOrders) {
            const originalDue = parseFloat(order.dueAmount);
            const originalPaid = parseFloat(order.paidAmount || 0);
            const total = parseFloat(order.totalAmount);

            // Update only the dues fields, no deletion of orders or other customer records
            order.dueAmount = 0;
            order.paidAmount = total;
            order.paymentStatus = 'Paid';

            const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const scriptNote = `\n[Party Dues Reset Script - ${dateStr}]: Reset outstanding due of ₹${originalDue.toFixed(2)} to 0. (Paid amount adjusted from ₹${originalPaid.toFixed(2)} to ₹${total.toFixed(2)}).`;
            order.notes = order.notes ? order.notes + scriptNote : scriptNote;

            await order.save({ transaction: t });
            updatedCount++;
        }

        await t.commit();
        console.log(`\nSuccessfully updated ${updatedCount} orders to 0 pending due. ✓`);
        console.log('Transaction committed successfully.');
        console.log('======================================================================\n');
    } catch (error) {
        await t.rollback();
        console.error('\n[Database Error] Transaction rolled back due to error:', error.message);
        throw error;
    } finally {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
});
