import sequelize from '../config/db.js';

async function run() {
  try {
    await sequelize.authenticate();
    console.log('Database connected.');
    
    // Add column closingBalance to users table if not exists
    await sequelize.query('ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "closingBalance" DECIMAL(12, 2) DEFAULT 0.00;');
    console.log('Column closingBalance added or already exists in users table.');

    // Also check if orders table needs any indexes
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_orders_user_created ON "orders" ("userId", "createdAt");');
    await sequelize.query('CREATE INDEX IF NOT EXISTS idx_order_payments_order ON "order_payments" ("orderId");');
    
    console.log('Database migrations completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

run();
