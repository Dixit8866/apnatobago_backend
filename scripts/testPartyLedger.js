import { Op } from 'sequelize';
import { User, Order } from '../models/index.js';
import { getPartyLedger } from '../services/partyLedger.service.js';

async function testActive() {
  try {
    const order = await Order.findOne({ where: { userId: { [Op.ne]: null } } });
    if (!order) {
      console.log('No order found with userId');
      process.exit(0);
    }
    console.log('Found order for userId:', order.userId, 'OrderId:', order.orderId);
    const ledger = await getPartyLedger(order.userId, {});
    console.log('Party:', ledger.user.fullname, ledger.user.shopName);
    console.log('Ledger summary:', JSON.stringify(ledger.summary, null, 2));
    console.log('Ledger rows count:', ledger.ledgerRows.length);
    if (ledger.ledgerRows.length > 0) {
      console.log('Rows:', JSON.stringify(ledger.ledgerRows, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  }
}

testActive();
