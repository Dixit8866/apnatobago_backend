import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';
import InventoryTransaction from '../models/superadmin-models/InventoryTransaction.js';
import StockTransfer from '../models/superadmin-models/StockTransfer.js';
import StockTransferItem from '../models/superadmin-models/StockTransferItem.js';

async function main() {
    console.log('[Reset Inventory] Connecting to database...');
    await sequelize.authenticate();
    console.log('[Reset Inventory] DB Connected.');

    const t = await sequelize.transaction();
    try {
        console.log('[Reset Inventory] Wiping stock transfer items...');
        const wipedTransferItems = await StockTransferItem.destroy({ where: {}, force: true, transaction: t });
        console.log(`[Reset Inventory] Wiped ${wipedTransferItems} stock transfer items.`);

        console.log('[Reset Inventory] Wiping stock transfers...');
        const wipedTransfers = await StockTransfer.destroy({ where: {}, force: true, transaction: t });
        console.log(`[Reset Inventory] Wiped ${wipedTransfers} stock transfers.`);

        console.log('[Reset Inventory] Wiping inventory transactions log...');
        const wipedTransactions = await InventoryTransaction.destroy({ where: {}, force: true, transaction: t });
        console.log(`[Reset Inventory] Wiped ${wipedTransactions} transactions.`);

        console.log('[Reset Inventory] Resetting all inventory stock units to 0...');
        const [updatedRowsCount] = await InventoryStock.update(
            { totalBaseUnits: 0 },
            { where: {}, transaction: t }
        );
        console.log(`[Reset Inventory] Reset ${updatedRowsCount} inventory stock entries to 0 base units.`);

        await t.commit();
        console.log('[Reset Inventory] Inventory reset completed successfully. ✓');
    } catch (error) {
        await t.rollback();
        console.error('[Reset Inventory] Transaction rolled back due to error:', error.message);
        throw error;
    } finally {
        await sequelize.close();
    }
}

main().catch((e) => {
    console.error('[Reset Inventory] Failed:', e.message);
    process.exit(1);
});
