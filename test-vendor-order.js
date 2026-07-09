import sequelize from './config/db.js';
import VendorOrder from './models/superadmin-models/VendorOrder.js';

(async () => {
  try {
    const orders = await VendorOrder.findAll({
      order: [['createdAt', 'DESC']],
      limit: 3,
    });
    console.log("LAST 3 VENDOR ORDERS:");
    orders.forEach(o => {
      console.log(`Order ID: ${o.id}, OrderNo: ${o.orderNo}`);
      console.log(`Items:`, JSON.stringify(o.items, null, 2));
    });
    process.exit(0);
  } catch (err) {
    console.error("ERROR:", err);
    process.exit(1);
  }
})();
