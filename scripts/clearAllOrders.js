import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import { 
    Order, 
    OrderItem, 
    OrderPayment, 
    OrderAssignment, 
    SalesReturn, 
    PartyBalanceLog,
    User
} from '../models/index.js';
import { Op } from 'sequelize';

/**
 * Script to safely clear and reset user orders.
 * 
 * Usage:
 *   1. Clear ALL orders across entire database:
 *      node scripts/clearAllOrders.js --all
 * 
 *   2. Clear orders for a SPECIFIC user by Phone Number:
 *      node scripts/clearAllOrders.js --phone=9429089905
 * 
 *   3. Clear orders for a SPECIFIC user by User ID:
 *      node scripts/clearAllOrders.js --userId=UUID-HERE
 * 
 *   Optional Flags:
 *      --reset-balance  (Resets user's creditline/advanceJama/balanceType to initial state)
 */

async function clearOrders() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database successfully.');

        // Parse CLI arguments
        const args = process.argv.slice(2);
        const isAll = args.includes('--all');
        const resetBalance = args.includes('--reset-balance');
        
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

        if (!isAll && !targetPhone && !targetUserId) {
            console.log('\n❌ ERROR: Please specify which orders to clear.');
            console.log('\n📌 Examples:');
            console.log('   node scripts/clearAllOrders.js --all');
            console.log('   node scripts/clearAllOrders.js --phone=9429089905');
            console.log('   node scripts/clearAllOrders.js --all --reset-balance');
            process.exit(1);
        }

        const t = await sequelize.transaction();

        try {
            let orderWhere = {};
            let targetUsers = [];

            if (targetPhone || targetUserId) {
                const userWhere = targetPhone 
                    ? { number: { [Op.like]: `%${targetPhone}` } }
                    : { id: targetUserId };

                targetUsers = await User.findAll({ where: userWhere, transaction: t });
                if (targetUsers.length === 0) {
                    console.log(`⚠️ No user found matching ${targetPhone || targetUserId}`);
                    await t.rollback();
                    process.exit(0);
                }

                const userIds = targetUsers.map(u => u.id);
                const userNumbers = targetUsers.map(u => String(u.number).replace(/\D/g, '').slice(-10)).filter(Boolean);

                const orConds = [{ userId: { [Op.in]: userIds } }];
                if (userNumbers.length > 0) {
                    orConds.push({
                        customerNumber: { [Op.or]: userNumbers.map(n => ({ [Op.like]: `%${n}` })) }
                    });
                }
                orderWhere = { [Op.or]: orConds };
                console.log(`🔍 Found ${targetUsers.length} user profile(s): ${targetUsers.map(u => `${u.fullname} (${u.number})`).join(', ')}`);
            } else {
                console.log('⚠️ MODE: Clearing ALL orders in the system...');
            }

            // 1. Fetch matching Order IDs
            const ordersToDelete = await Order.findAll({
                where: orderWhere,
                attributes: ['id', 'orderId'],
                transaction: t,
                paranoid: false
            });

            const orderIds = ordersToDelete.map(o => o.id);
            console.log(`📦 Found ${orderIds.length} order(s) to remove.`);

            if (orderIds.length > 0) {
                // Delete Order Items
                const deletedItems = await OrderItem.destroy({
                    where: { orderId: { [Op.in]: orderIds } },
                    force: true,
                    transaction: t
                });

                // Delete Order Payments
                const deletedPayments = await OrderPayment.destroy({
                    where: { orderId: { [Op.in]: orderIds } },
                    force: true,
                    transaction: t
                });

                // Delete Order Assignments
                const deletedAssignments = await OrderAssignment.destroy({
                    where: { orderId: { [Op.in]: orderIds } },
                    force: true,
                    transaction: t
                });

                // Delete Sales Returns associated with orders
                const deletedReturns = await SalesReturn.destroy({
                    where: { orderId: { [Op.in]: orderIds } },
                    force: true,
                    transaction: t
                });

                // Delete Orders
                const deletedOrders = await Order.destroy({
                    where: { id: { [Op.in]: orderIds } },
                    force: true,
                    transaction: t
                });

                console.log(`\n🧹 CLEANUP SUMMARY:`);
                console.log(`   - Deleted Orders:       ${deletedOrders}`);
                console.log(`   - Deleted Order Items:  ${deletedItems}`);
                console.log(`   - Deleted Payments:     ${deletedPayments}`);
                console.log(`   - Deleted Assignments:  ${deletedAssignments}`);
                console.log(`   - Deleted Sales Returns:${deletedReturns}`);
            }

            // Optionally reset balance for target users or all users
            if (resetBalance) {
                if (targetUsers.length > 0) {
                    for (const u of targetUsers) {
                        u.advanceJama = 0;
                        u.balanceType = 'CLEAR';
                        await u.save({ transaction: t });
                    }
                    console.log(`   - Reset balance for ${targetUsers.length} user(s).`);
                } else if (isAll) {
                    await User.update({
                        advanceJama: 0,
                        balanceType: 'CLEAR'
                    }, { where: {}, transaction: t });
                    console.log(`   - Reset balance for all users.`);
                }
            }

            await t.commit();
            console.log('\n🎉 ALL SPECIFIED ORDERS HAVE BEEN SUCCESSFULLY CLEARED!\n');
            process.exit(0);
        } catch (innerErr) {
            await t.rollback();
            throw innerErr;
        }
    } catch (err) {
        console.error('❌ Error executing clear orders script:', err.message);
        process.exit(1);
    }
}

clearOrders();
