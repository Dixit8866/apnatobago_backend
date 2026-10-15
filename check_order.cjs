const { Sequelize } = require('sequelize');
const s = new Sequelize('postgres://postgres:8866@localhost:5432/tobaco_app', { logging: false });
s.query(`SELECT id, "orderId", "orderStatus", "createdAt" FROM orders ORDER BY "createdAt" DESC LIMIT 10`, { type: s.QueryTypes.SELECT })
  .then(r => { console.log('ORDERS:', JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error('ERR:', e); process.exit(1); });
