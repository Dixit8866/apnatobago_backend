import sequelize from './config/db.js';
// Enable logging on the shared sequelize instance
sequelize.options.logging = console.log;

import { OrderPayment, Order, User, DeliveryBoy, BankSetting } from './models/index.js';

async function testQuery() {
  try {
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

  } catch (err) {
    console.error('Error during query test:', err);
  } finally {
    await sequelize.close();
  }
}

testQuery();
