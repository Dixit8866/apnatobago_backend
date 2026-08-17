import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const backendRoot = join(__dirname, '..');
const envPath = join(backendRoot, '.env');
const envProdPath = join(backendRoot, '.env.production');

if (process.env.NODE_ENV === 'production' && fs.existsSync(envProdPath)) {
    dotenv.config({ path: envProdPath });
} else if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    dotenv.config();
}

const { default: sequelize } = await import('../config/db.js');
const { Order, User, BusinessProfile } = await import('../models/index.js');
import { Op } from 'sequelize';

async function main() {
    const args = process.argv.slice(2);
    const isExecute = args.includes('--execute') || args.includes('-e');

    const targetId = 'd8166d09-241b-45b8-b6f8-8cc01cd43b47';
    const todayDateStr = '2026-08-17';

    console.log('======================================================================');
    console.log('    PARTY PENDING DUE RESET SCRIPT (EXCLUDING TODAY 17-08-2026)      ');
    console.log('======================================================================');
    console.log(`Running Mode: ${isExecute ? '⚠️ EXECUTE / COMMIT' : 'ℹ️ DRY RUN (No changes will be saved)'}`);
    console.log(`Target ID: ${targetId}`);
    console.log(`Today's Date: ${todayDateStr}`);
    console.log('----------------------------------------------------------------------');

    await sequelize.authenticate();
    console.log('Database connected successfully.');

    // 1. Search Business Profile by PK (including soft-deleted)
    let profile = await BusinessProfile.findByPk(targetId, {
        paranoid: false,
        include: [{ model: User, as: 'user', paranoid: false }]
    });

    let targetUser = null;
    let userId = null;

    if (profile) {
        console.log(`✅ Found BusinessProfile by ID: ${profile.id}`);
        userId = profile.userId;
        targetUser = profile.user;
    } else {
        console.log(`⚠️ No BusinessProfile found with direct PK ${targetId}. Searching User table by ID...`);
        targetUser = await User.findByPk(targetId, { paranoid: false });
        if (targetUser) {
            console.log(`✅ Found User by ID: ${targetUser.id}`);
            userId = targetUser.id;
            profile = await BusinessProfile.findOne({ where: { userId: userId }, paranoid: false });
        }
    }

    if (!userId) {
        console.log(`⚠️ ID ${targetId} not found in BusinessProfile or User by direct PK. Searching by shopName/fullname (%સોનલ% / %raju%)...`);
        const matchingProfiles = await BusinessProfile.findAll({
            where: {
                [Op.or]: [
                    { shopName: { [Op.iLike]: '%સોનલ%' } },
                    { shopName: { [Op.iLike]: '%sonal%' } },
                    { shopName: { [Op.iLike]: '%શક્તિ%' } }
                ]
            },
            include: [{ model: User, as: 'user' }],
            paranoid: false
        });

        console.log(`Found ${matchingProfiles.length} profiles matching name search:`);
        matchingProfiles.forEach(p => {
            console.log(`  - Business Profile ID: ${p.id} | Shop: ${p.shopName} | User ID: ${p.userId} | User: ${p.user ? p.user.fullname : 'N/A'}`);
        });

        if (matchingProfiles.length > 0) {
            profile = matchingProfiles[0];
            userId = profile.userId;
            targetUser = profile.user;
        } else {
            console.log(`Searching User table for name '%raju%'...`);
            const matchingUsers = await User.findAll({
                where: {
                    [Op.or]: [
                        { fullname: { [Op.iLike]: '%raju%' } },
                        { fullname: { [Op.iLike]: '%સોનલ%' } }
                    ]
                },
                paranoid: false
            });
            matchingUsers.forEach(u => {
                console.log(`  - User ID: ${u.id} | Name: ${u.fullname} | Phone: ${u.number}`);
            });
        }
    }

    if (!userId) {
        console.error(`❌ Could not locate any matching party/user records in the database.`);
        process.exit(1);
    }

    console.log('\n--- VERIFIED BUSINESS PROFILE & USER DETAILS ---');
    console.log(`Shop Name       : ${profile ? profile.shopName : 'N/A'}`);
    console.log(`User Name       : ${targetUser ? targetUser.fullname : 'N/A'}`);
    console.log(`Mobile Number   : ${targetUser ? targetUser.number : 'N/A'}`);
    console.log(`User ID         : ${userId}`);
    console.log(`Business ID     : ${profile ? profile.id : 'N/A'}`);
    console.log('----------------------------------------------------------------------');

    // 2. Fetch all orders for this user
    const allOrders = await Order.findAll({
        where: { userId: userId },
        order: [['createdAt', 'DESC']],
        paranoid: false
    });

    if (allOrders.length === 0) {
        console.log('No orders found for this party in the database.');
        process.exit(0);
    }

    console.log(`\nFound total ${allOrders.length} orders for this party.`);
    console.log('\n--- ALL ORDERS FOR THIS PARTY ---');
    console.log(
        '#   | Order ID       | Order Date | Created At           | Total Amt  | Due Amt    | Paid Amt   | Status            | Action'
    );
    console.log('-----------------------------------------------------------------------------------------------------------------------------------------');

    let eligibleForReset = [];
    let todayOrders = [];
    let skippedOrders = [];

    allOrders.forEach((o, idx) => {
        const oDate = o.orderDate ? String(o.orderDate) : null;
        const createdDate = o.createdAt ? new Date(o.createdAt).toISOString().split('T')[0] : null;
        
        const isToday = (oDate === todayDateStr) || (createdDate === todayDateStr);
        const dueVal = parseFloat(o.dueAmount || 0);

        let action = '';
        if (isToday) {
            action = '🔒 SKIP (Today 17-Aug Bill)';
            todayOrders.push(o);
        } else if (dueVal > 0 && o.orderStatus !== 'Cancelled') {
            action = 'RESET TO 0 DUE';
            eligibleForReset.push(o);
        } else {
            action = 'SKIP (Already 0 due or Cancelled)';
            skippedOrders.push(o);
        }

        console.log(
            `${String(idx + 1).padEnd(3)} | ${String(o.orderId).padEnd(14)} | ${String(oDate || 'N/A').padEnd(10)} | ${String(createdDate || 'N/A').padEnd(20)} | ₹${String(
                o.totalAmount
            ).padEnd(9)} | ₹${String(o.dueAmount).padEnd(9)} | ₹${String(o.paidAmount || 0).padEnd(9)} | ${String(o.orderStatus).padEnd(17)} | ${action}`
        );
    });
    console.log('-----------------------------------------------------------------------------------------------------------------------------------------');

    console.log(`\nToday's Bills Kept As-Is (17-08-2026): ${todayOrders.length} order(s)`);
    todayOrders.forEach(o => {
        console.log(`  - Order ${o.orderId} | Total: ₹${o.totalAmount} | Due: ₹${o.dueAmount} | Status: ${o.orderStatus}`);
    });

    console.log(`\nOrders Eligible to Zero Out Due Amount: ${eligibleForReset.length} order(s)`);

    if (eligibleForReset.length === 0) {
        console.log('No older orders with pending due found. Nothing to update.');
        process.exit(0);
    }

    let totalDueToClear = 0;
    console.log('\n--- SUMMARY OF ORDERS TO RESET TO 0 DUE ---');
    eligibleForReset.forEach((o, index) => {
        const dueVal = parseFloat(o.dueAmount);
        totalDueToClear += dueVal;
        console.log(
            `${index + 1}. Order: ${o.orderId} | Date: ${o.orderDate || o.createdAt} | Total: ₹${o.totalAmount} | Current Due: ₹${o.dueAmount}`
        );
    });
    console.log(`\nTotal Due Amount to be Cleared (Reset to 0): ₹${totalDueToClear.toFixed(2)}`);
    console.log('----------------------------------------------------------------------');

    if (!isExecute) {
        console.log('\n[DRY RUN COMPLETE] No changes were written to the database.');
        console.log('To apply these updates to the database, run:');
        console.log('    $env:NODE_ENV="production"; node scripts/resetPendingDuesExceptTodayForProfile.js --execute');
        console.log('======================================================================\n');
        process.exit(0);
    }

    console.log('\nExecuting updates in database...');
    const t = await sequelize.transaction();

    try {
        let updatedCount = 0;
        for (const order of eligibleForReset) {
            const originalDue = parseFloat(order.dueAmount);
            const originalPaid = parseFloat(order.paidAmount || 0);
            const total = parseFloat(order.totalAmount);

            order.dueAmount = 0;
            order.paidAmount = total;
            order.paymentStatus = 'Paid';

            const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const scriptNote = `\n[Pending Due Reset Script - ${dateStr}]: Reset outstanding due of ₹${originalDue.toFixed(2)} to 0 (Excluding 17-08-2026 bill).`;
            order.notes = order.notes ? order.notes + scriptNote : scriptNote;

            await order.save({ transaction: t });
            updatedCount++;
        }

        await t.commit();
        console.log(`\n✅ SUCCESSFULLY UPDATED ${updatedCount} OLD ORDERS TO 0 PENDING DUE!`);
        console.log('Database transaction committed.');
        console.log('======================================================================\n');
    } catch (err) {
        await t.rollback();
        console.error('❌ Error updating database. Transaction rolled back:', err.message);
        throw err;
    } finally {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
});
