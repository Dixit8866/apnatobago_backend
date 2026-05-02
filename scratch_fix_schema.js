import sequelize from './config/db.js';

async function fixSchema() {
  try {
    console.log('Altering product_pricings table...');
    await sequelize.query('ALTER TABLE product_pricings ALTER COLUMN "minQty" TYPE numeric(10,2) USING "minQty"::numeric(10,2);');
    await sequelize.query('ALTER TABLE product_pricings ALTER COLUMN "maxQty" TYPE numeric(10,2) USING "maxQty"::numeric(10,2);');
    console.log('Successfully altered columns in product_pricings.');
    process.exit(0);
  } catch (error) {
    console.error('Error altering table:', error);
    process.exit(1);
  }
}

fixSchema();
