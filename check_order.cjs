const { Sequelize } = require('sequelize');
const s = new Sequelize('postgres://postgres:8866@localhost:5432/tobaco_app', { logging: false });
s.query(`SELECT o.id, o."orderId", o."orderStatus", oa."deliveryBoyId", db.name as "deliveryBoyName" 
  FROM orders o 
  LEFT JOIN order_assignments oa ON oa."orderId" = o.id 
  LEFT JOIN delivery_boys db ON oa."deliveryBoyId" = db.id 
  WHERE o."orderId" IN ('30386', '30385', '30384', '30383', '30376')`, { type: s.QueryTypes.SELECT })
  .then(r => { console.log('SHIPPING_ORDERS:', JSON.stringify(r)); process.exit(0); })
  .catch(e => { console.error('ERR:', e); process.exit(1); });
