import sequelize from './config/db.js';
import { User, Order, OrderPayment } from './models/index.js';

async function test() {
  try {
    const user = await User.findOne({
      where: { fullname: 'Dixit Mathukiya' }
    });
    
    if (!user) {
      console.log("User Dixit Mathukiya not found!");
      process.exit(0);
    }
    
    console.log("USER DETAILS:", {
      id: user.id,
      fullname: user.fullname,
      creditline: user.creditline,
      blockcredit: user.blockcredit
    });
    
    const orders = await Order.findAll({
      where: { userId: user.id },
      order: [['createdAt', 'DESC']]
    });
    
    console.log("ORDERS COUNT:", orders.length);
    console.log("ORDERS:", JSON.stringify(orders.map(o => ({
      id: o.id,
      orderId: o.orderId,
      totalAmount: o.totalAmount,
      dueAmount: o.dueAmount,
      paidAmount: o.paidAmount,
      paymentStatus: o.paymentStatus,
      orderStatus: o.orderStatus,
      paymentMethod: o.paymentMethod,
      createdAt: o.createdAt
    })), null, 2));
    
    const payments = await OrderPayment.findAll({
      where: {
        orderId: orders.map(o => o.id)
      },
      order: [['createdAt', 'DESC']]
    });
    
    console.log("PAYMENTS COUNT:", payments.length);
    console.log("PAYMENTS:", JSON.stringify(payments.map(p => ({
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      notes: p.notes,
      createdAt: p.createdAt
    })), null, 2));
    
  } catch (err) {
    console.error(err);
  }
  process.exit(0);
}
test();
