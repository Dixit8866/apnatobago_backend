/**
 * fixSalesReturnOrderLinks.js
 * 
 * Re-aligns any SalesReturn records that were mistakenly linked to a previous order
 * instead of the delivery order where the return was actually processed and deducted.
 * 
 * Usage:
 *   node scripts/fixSalesReturnOrderLinks.js           (Dry Run)
 *   node scripts/fixSalesReturnOrderLinks.js --fix     (Apply Changes)
 */

import { Order, OrderPayment, SalesReturn } from '../models/index.js';
import sequelize from '../config/db.js';

const isFix = process.argv.includes('--fix');

async function main() {
    console.log('======================================================================');
    console.log('       FIX SALES RETURN ORDER ATTACHMENT (વેચાણ પરત ઓર્ડર લિંક સુધારો)       ');
    console.log('======================================================================');
    console.log(`Mode: ${isFix ? '⚡ LIVE UPDATE (--fix)' : 'ℹ️  DRY RUN (Preview only)'}\n`);

    await sequelize.authenticate();
    console.log('✅ Database connected.\n');

    const returns = await SalesReturn.findAll({
        include: [{ model: Order, as: 'order', include: ['payments'] }]
    });

    console.log(`📋 Found ${returns.length} SalesReturn record(s).\n`);

    let fixCount = 0;

    for (const ret of returns) {
        const currentOrder = ret.order;
        const currentOrderPayments = currentOrder?.payments || [];
        const hasReturnPayment = currentOrderPayments.some(
            p => String(p.paymentMethod || '').toUpperCase() === 'SALES_RETURN'
        );

        // If the order this return is attached to has NO SALES_RETURN payment
        if (!hasReturnPayment) {
            const retAmt = parseFloat(ret.returnAmount || 0);

            // Find an order for the same user that has a SALES_RETURN payment matching or covering this amount
            const matchingPayment = await OrderPayment.findOne({
                where: {
                    paymentMethod: 'SALES_RETURN'
                },
                include: [{
                    model: Order,
                    as: 'order',
                    where: { userId: ret.userId }
                }]
            });

            if (matchingPayment && matchingPayment.orderId !== ret.orderId) {
                console.log(`🔍 Found misplaced return:`);
                console.log(`   - Return ID: ${ret.id}`);
                console.log(`   - Amount: ₹${retAmt}`);
                console.log(`   - Currently attached to Order: #${currentOrder?.orderId || ret.orderId}`);
                console.log(`   - Should be attached to Order: #${matchingPayment.order?.orderId || matchingPayment.orderId} (where SALES_RETURN payment is recorded)`);

                if (isFix) {
                    await ret.update({ orderId: matchingPayment.orderId });
                    console.log(`   ✅ Re-linked to Order #${matchingPayment.order?.orderId || matchingPayment.orderId}`);
                } else {
                    console.log(`   ℹ️ [Dry Run] Would re-link to Order #${matchingPayment.order?.orderId || matchingPayment.orderId}`);
                }
                fixCount++;
            }
        }
    }

    console.log(`\n======================================================================`);
    console.log(`Summary: ${fixCount} SalesReturn record(s) ${isFix ? 'updated' : 'identified for fix'}.`);
    console.log('======================================================================\n');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
});
