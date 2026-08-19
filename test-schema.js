import sequelize from './config/db.js';
import { OrderPayment } from './models/index.js';

async function test() {
  try {
    await sequelize.authenticate();
    
    const [results] = await sequelize.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'order_payments';`
    );
  } catch (err) {
    console.error('Error during schema check:', err);
  } finally {
    await sequelize.close();
  }
}

test();
