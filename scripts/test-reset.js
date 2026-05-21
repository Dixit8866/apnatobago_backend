import sequelize, { connectDB } from '../config/db.js';
import { resetInventoryOnStartup } from './resetInventoryOnStartup.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';

const runTest = async () => {
    try {
        await connectDB();
        await resetInventoryOnStartup();
        
        // Query and print some stocks to verify they are all exactly 100
        const stocks = await InventoryStock.findAll({
            limit: 10,
            where: { deletedAt: null }
        });
        
        console.log('\n--- VERIFICATION: STOCKS SAMPLE (LIMIT 10) ---');
        stocks.forEach(s => {
            console.log(`Stock ID: ${s.id} | Product: ${s.productId} | Variant: ${s.variantId} | Quantity: ${s.totalBaseUnits}`);
        });
        console.log('----------------------------------------------');
        
        // Count how many have stock other than 100
        const non100Count = await InventoryStock.count({
            where: {
                totalBaseUnits: {
                    [sequelize.Sequelize.Op.ne]: 100
                },
                deletedAt: null
            }
        });
        console.log(`Verification: Number of active stock records that are NOT 100: ${non100Count}`);
        
        process.exit(0);
    } catch (e) {
        console.error('Test script failed:', e);
        process.exit(1);
    }
};

runTest();
