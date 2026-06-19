import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import sequelize from '../config/db.js';
import { Order, User, RouteCategory } from '../models/index.js';

async function check() {
  try {
    await sequelize.authenticate();
    console.log('Connected to DB');

    const o = await Order.findOne({
      where: { orderId: '1002' },
      include: [
        { model: User, as: 'user', include: [{ model: RouteCategory, as: 'routeCategory' }] },
        { model: RouteCategory, as: 'routeCategory' }
      ]
    });

    if (!o) {
      console.log('Order 1002 not found in DB!');
      // Let's print the last 5 orders
      const lastOrders = await Order.findAll({ limit: 5, order: [['createdAt', 'DESC']] });
      console.log('Last 5 orders in DB:');
      for (const lo of lastOrders) {
        console.log(`- OrderId: ${lo.orderId}, Status: ${lo.orderStatus}, saleType: ${lo.saleType}, routeCategoryId: ${lo.routeCategoryId}`);
      }
    } else {
      console.log(`Order ID: ${o.orderId}`);
      console.log(`Order Status: ${o.orderStatus}`);
      console.log(`Order routeCategoryId: ${o.routeCategoryId} (${o.routeCategory?.name})`);
      console.log(`User ID: ${o.userId} (${o.user?.fullname})`);
      console.log(`User routeCategoryId: ${o.user?.routeCategoryId} (${o.user?.routeCategory?.name})`);
      console.log(`Full Order info:`, JSON.stringify(o.toJSON(), null, 2));
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

check();
