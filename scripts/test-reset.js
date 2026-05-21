import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';

async function main() {
    try {
        console.log('[Reset] Connecting to database...');
        await sequelize.authenticate();
        console.log('[Reset] Database connected successfully.');

        console.log('[Reset] Resetting all inventory stock to 0...');
        const [result] = await sequelize.query(
            `UPDATE inventory_stocks
             SET    "totalBaseUnits" = 0,
                    "updatedAt"      = NOW()
             WHERE  "deletedAt" IS NULL`
        );
        
        const affected = result?.rowCount ?? result?.affectedRows ?? '?';
        console.log(`[Reset] Success! Reset ${affected} stock records to 0.`);
    } catch (error) {
        console.error('[Reset Failed] Error:', error.message || error);
    } finally {
        await sequelize.close();
        console.log('[Reset] Database connection closed.');
    }
}

main();
