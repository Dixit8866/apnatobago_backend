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
    const isExecute = process.argv.includes('--execute') || process.argv.includes('-e');

    console.log('======================================================================');
    console.log('                 PENDING DUE RESET SCRIPT                             ');
    console.log('======================================================================');
    console.log(`Running in mode: ${isExecute ? '⚠️ EXECUTE / COMMIT' : 'ℹ️ DRY RUN (No changes)'}`);
    console.log('Connecting to database...');

    await sequelize.authenticate();
    console.log('Database connected successfully.');

    const exclusionOrderIds = ['4406692332', '4406692331', '4406692330'];
    console.log('\nSearching for exclusion orders:');
    exclusionOrderIds.forEach(id => console.log(` - Order ID: ${id}`));

    const exclusionOrders = await Order.findAll({
        where: { orderId: exclusionOrderIds },
        include: [{ model: User, as: 'user' }]
    });

    const excludedUserIds = new Set();
    const excludedUsersInfo = [];

    for (const order of exclusionOrders) {
        if (order.userId) {
            excludedUserIds.add(order.userId);
        }
        excludedUsersInfo.push({
            orderId: order.orderId,
            customerName: order.customerName || (order.user ? order.user.fullname : 'N/A'),
            customerNumber: order.customerNumber || (order.user ? order.user.number : 'N/A'),
            userId: order.userId || 'N/A'
        });
    }

    console.log(`\nExclusion Summary: Found ${exclusionOrders.length} of ${exclusionOrderIds.length} exclusion orders in the database.`);
    if (excludedUsersInfo.length > 0) {
        console.log('The following parties/customers will be EXCLUDED from dues reset:');
        excludedUsersInfo.forEach((info, idx) => {
            console.log(`  ${idx + 1}. Order ${info.orderId} placed by: ${info.customerName} (${info.customerNumber}), User ID: ${info.userId}`);
        });
    } else {
        console.log('  No matching exclusion orders/parties found in this database. Proceeding with caution.');
    }

    const excludedUserIdsArray = Array.from(excludedUserIds);

    const queryConditions = {
        dueAmount: { [Op.gt]: 0 },
        orderStatus: {
            [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
        }
    };

    if (excludedUserIdsArray.length > 0) {
        queryConditions.userId = {
            [Op.or]: [
                { [Op.notIn]: excludedUserIdsArray },
                { [Op.is]: null }
            ]
        };
    }

    const eligibleOrders = await Order.findAll({
        where: queryConditions,
        include: [{ model: User, as: 'user' }],
        order: [['createdAt', 'DESC']]
    });

    console.log(`\nFound ${eligibleOrders.length} orders with pending dues eligible for reset.`);

    if (eligibleOrders.length === 0) {
        console.log('No orders to update. Exiting.');
        process.exit(0);
    }

    let totalDuesAmount = 0;
    console.log('\nList of orders to reset:');
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    console.log(
        '#   | Order ID       | Customer Name             | Phone          | Total Amt  | Due Amt    | Status            | Created At'
    );
    console.log('------------------------------------------------------------------------------------------------------------------------------------------');
    eligibleOrders.forEach((o, index) => {
        const name = o.customerName || (o.user ? o.user.fullname : 'Direct Sale/Guest');
        const phone = o.customerNumber || (o.user ? o.user.number : 'N/A');
        const dueVal = parseFloat(o.dueAmount);
        totalDuesAmount += dueVal;
        console.log(
            `${String(index + 1).padEnd(3)} | ${String(o.orderId).padEnd(14)} | ${name.padEnd(25).substring(0, 25)} | ${phone.padEnd(14)} | ₹${String(
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
        console.log('    node scripts/resetPendingDues.js --execute');
        console.log('======================================================================\n');
        process.exit(0);
    }

    console.log('\nExecuting database updates...');
    const t = await sequelize.transaction();

    try {
        let updatedCount = 0;
        for (const order of eligibleOrders) {
            const originalDue = parseFloat(order.dueAmount);
            const originalPaid = parseFloat(order.paidAmount || 0);
            const total = parseFloat(order.totalAmount);

            order.dueAmount = 0;
            order.paidAmount = total;
            order.paymentStatus = 'Paid';

            const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const scriptNote = `\n[Dues Reset Script - ${dateStr}]: Reset outstanding due of ₹${originalDue.toFixed(2)} to 0. (Paid amount adjusted from ₹${originalPaid.toFixed(2)} to ₹${total.toFixed(2)}).`;
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
