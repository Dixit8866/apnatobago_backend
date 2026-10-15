const { Sequelize } = require('sequelize');
const s = new Sequelize('postgres://postgres:8866@localhost:5432/tobaco_app', { logging: false });
s.query(`SELECT id, "orderId", "orderStatus", "paymentCollectStatus", "paymentStatus", "deliveredAt", "createdAt", "updatedAt" FROM orders WHERE CAST("orderId" AS TEXT) LIKE '%26023%'`, { type: s.QueryTypes.SELECT })
  .then(r => { console.log('ORDER_RESULT:', JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error('ERR:', e); process.exit(1); });
