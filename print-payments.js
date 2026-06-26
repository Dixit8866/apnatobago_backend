import sequelize from './config/db.js';

async function printPayments() {
  try {
    await sequelize.authenticate();
    const [results] = await sequelize.query(
      `SELECT id, "paymentMethod", amount, "isSubmitted" FROM order_payments LIMIT 10;`
    );
    console.log('Sample order payments in DB:');
    console.log(results);

    const [methods] = await sequelize.query(
      `SELECT DISTINCT "paymentMethod" FROM order_payments;`
    );
    console.log('All unique payment methods in DB:');
    console.log(methods);

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sequelize.close();
  }
}

printPayments();
