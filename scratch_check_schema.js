import sequelize from './config/db.js';
import { QueryTypes } from 'sequelize';

async function checkSchema() {
  try {
    const results = await sequelize.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_pricings';",
      { type: QueryTypes.SELECT }
    );
    console.log('Schema for product_pricings:', JSON.stringify(results, null, 2));
    
    const results2 = await sequelize.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'product_variants';",
      { type: QueryTypes.SELECT }
    );
    console.log('Schema for product_variants:', JSON.stringify(results2, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking schema:', error);
    process.exit(1);
  }
}

checkSchema();
