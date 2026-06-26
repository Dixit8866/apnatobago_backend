import sequelize from './config/db.js';
import { OrderPayment, Order, User, DeliveryBoy, BankSetting } from './models/index.js';

async function testQuery() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully.');

    console.log('Running OrderPayment.findAndCountAll query...');
    const result = await OrderPayment.findAndCountAll({
        where: {},
        include: [
            {
                model: Order,
                as: 'order',
                attributes: ['id', 'orderId', 'totalAmount', 'paymentMethod', 'paymentStatus', 'customerName', 'customerNumber'],
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'fullname', 'number', 'city']
                    }
                ]
            },
            {
                model: DeliveryBoy,
                as: 'deliveryBoy',
                attributes: ['id', 'name', 'phone', 'vehicleNumber']
            },
            {
                model: BankSetting,
                as: 'bankAccount',
                attributes: ['id', 'bankName', 'accountName', 'accountNumber', 'branchName'],
                required: false
            }
        ],
        limit: 10,
        offset: 0,
        order: [['createdAt', 'DESC']],
        distinct: true
    });

    console.log('Query executed successfully!');
    console.log('Total records:', result.count);
    console.log('Sample rows:', result.rows.length);

    console.log('Running counts query...');
    const [cashCount, onlineCount, creditCount, submittedCount, pendingSubmitCount, razorpayCount, bankAccountCount] = await Promise.all([
        OrderPayment.count({ where: { paymentMethod: 'CASH' } }),
        OrderPayment.count({ where: { paymentMethod: 'ONLINE' } }),
        OrderPayment.count({ where: { paymentMethod: 'CREDIT' } }),
        OrderPayment.count({ where: { isSubmitted: true } }),
        OrderPayment.count({ where: { isSubmitted: false } }),
        OrderPayment.count({ where: { paymentMethod: 'ONLINE', onlineType: 'Razorpay' } }),
        OrderPayment.count({ where: { paymentMethod: 'ONLINE', onlineType: 'Bank Account' } })
    ]);
    console.log('Counts:', { cashCount, onlineCount, creditCount, submittedCount, pendingSubmitCount, razorpayCount, bankAccountCount });

  } catch (err) {
    console.error('Error during query test:', err);
  } finally {
    await sequelize.close();
  }
}

testQuery();
