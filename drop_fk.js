import sequelize from './config/db.js';

async function run() {
  try {
    await sequelize.query('ALTER TABLE party_ledgers DROP CONSTRAINT IF EXISTS party_ledgers_orderId_fkey;');
    await sequelize.query('ALTER TABLE party_ledgers DROP CONSTRAINT IF EXISTS "party_ledgers_orderId_fkey";');
    console.log('CONSTRAINT_DROPPED_SUCCESSFULLY');
  } catch (err) {
    console.error('Error dropping constraint:', err.message);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

run();
