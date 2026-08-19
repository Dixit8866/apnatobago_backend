import sequelize from './config/db.js';

async function printPayments() {
  try {
    await sequelize.authenticate();
    const [results] = await sequelize.query(
      `SELECT id, "paymentMethod", amount, "isSubmitted" FROM order_payments LIMIT 10;`
    );

    const [methods] = await sequelize.query(
      `SELECT DISTINCT "paymentMethod" FROM order_payments;`
    );

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await sequelize.close();
  }
}

printPayments();
