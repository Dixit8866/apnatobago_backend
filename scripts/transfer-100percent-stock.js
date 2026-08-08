// npm run transfer-100percent:prod

import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import {
    Godown,
    InventoryStock,
    InventoryTransaction,
    StockTransfer,
    StockTransferItem,
    Product,
    ProductVariant,
    runManualMigrations
} from '../models/index.js';

// Default Target Godown UUIDs provided by user
const DEFAULT_MASTER_GODOWN_ID = 'f0462476-ff99-4899-93b0-29b1a5c2b012';
const DEFAULT_VARACHHA_GODOWN_ID = 'f58d9f15-67f2-4f18-b080-f3c032ccebf8';

async function transferStock() {
    // Parse CLI options / environment variables
    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run');

    const getArgVal = (flag) => {
        const index = args.indexOf(flag);
        if (index !== -1 && args[index + 1]) return args[index + 1];
        return null;
    };

    const fromGodownId = getArgVal('--from') || process.env.MASTER_GODOWN_ID || DEFAULT_MASTER_GODOWN_ID;
    const toGodownId = getArgVal('--to') || process.env.VARACHHA_GODOWN_ID || DEFAULT_VARACHHA_GODOWN_ID;
    const percentage = Number(getArgVal('--percentage') || 100);

    console.log('===========================================================');
    console.log('       100% (ALL STOCK) AUTOMATED TRANSFER SCRIPT         ');
    console.log('===========================================================');
    console.log(`Source Godown (Master)      : ${fromGodownId}`);
    console.log(`Destination Godown (Varachha): ${toGodownId}`);
    console.log(`Transfer Percentage         : ${percentage}% (Full Transfer)`);
    console.log(`Execution Mode              : ${isDryRun ? 'DRY-RUN (Simulated)' : 'LIVE EXECUTION'}`);
    console.log('===========================================================');

    await sequelize.authenticate();
    console.log('[DB] Database connection established successfully.');
    await runManualMigrations();

    // Fetch Source & Destination Godowns
    const fromGodown = await Godown.findByPk(fromGodownId);
    const toGodown = await Godown.findByPk(toGodownId);

    if (!fromGodown || !toGodown) {
        console.error('\n[ERROR] One or both specified Godown IDs were not found in database:');
        if (!fromGodown) console.error(`  - Source Godown (${fromGodownId}): NOT FOUND`);
        if (!toGodown) console.error(`  - Destination Godown (${toGodownId}): NOT FOUND`);
        
        console.log('\nAvailable Godowns in database:');
        const availableGodowns = await Godown.findAll({ attributes: ['id', 'name', 'status'] });
        availableGodowns.forEach(g => {
            console.log(`  - [${g.status}] ${g.name} (ID: ${g.id})`);
        });

        console.log('\nUsage hint: You can pass custom godown IDs via flags or environment variables:');
        console.log('  node scripts/transfer-100percent-stock.js --from <MASTER_ID> --to <VARACHHA_ID> [--dry-run]\n');
        await sequelize.close();
        process.exit(1);
    }

    if (fromGodownId === toGodownId) {
        console.error('\n[ERROR] Source and destination godowns cannot be identical.');
        await sequelize.close();
        process.exit(1);
    }

    console.log(`Source Godown Name     : ${fromGodown.name}`);
    console.log(`Destination Godown Name: ${toGodown.name}`);

    // Begin Sequelize Transaction for complete atomicity & safety
    const t = await sequelize.transaction();

    try {
        // Fetch all active stocks in source godown with totalBaseUnits > 0
        const sourceStocks = await InventoryStock.findAll({
            where: {
                godownId: fromGodownId,
                status: 'Active'
            },
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name']
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    attributes: ['id', 'volume', 'purchasePrice', 'baseUnitsPerPack']
                }
            ],
            transaction: t
        });

        const stocksToTransfer = sourceStocks.filter(s => Number(s.totalBaseUnits || 0) > 0);

        if (stocksToTransfer.length === 0) {
            console.log('\n[INFO] No available stock (totalBaseUnits > 0) found in source godown.');
            await t.rollback();
            await sequelize.close();
            return;
        }

        console.log(`\nFound ${stocksToTransfer.length} product variant(s) with available stock in ${fromGodown.name}.\n`);

        const transferNo = `TRF-100PCT-${Date.now()}`;
        
        // Create master StockTransfer record
        const transferRecord = await StockTransfer.create({
            transferNo,
            fromGodownId,
            toGodownId,
            status: 'Received',
            note: `Automated 100% full stock transfer from ${fromGodown.name} to ${toGodown.name}`,
            totalAmount: 0,
            createdBy: 'System (100% Full Auto Transfer Script)'
        }, { transaction: t });

        let grandTotalValue = 0;
        let processedCount = 0;

        for (const stock of stocksToTransfer) {
            const currentBaseUnits = Number(stock.totalBaseUnits);
            
            // Calculate 100% transfer quantity in base units
            const transferBaseUnits = Math.floor(currentBaseUnits * (percentage / 100.0));

            if (transferBaseUnits <= 0) {
                console.log(` - Skipping [${stock.product?.name?.en || 'Product'}] (${stock.variant?.volume || 'Variant'}): Stock is zero.`);
                continue;
            }

            const newSourceBaseUnits = currentBaseUnits - transferBaseUnits;
            const factor = Number(stock.variant?.baseUnitsPerPack || 1);
            const transferPacks = Math.max(1, Math.floor(transferBaseUnits / factor));
            const pricePerPack = Number(stock.variant?.purchasePrice || 0);
            const itemTotalAmount = pricePerPack * transferPacks;
            grandTotalValue += itemTotalAmount;

            const productNameEn = stock.product?.name?.en || stock.product?.name?.gu || stock.product?.name || 'Unknown Product';
            const variantVol = stock.variant?.volume || 'N/A';

            console.log(`[FULL TRANSFER] Product: "${productNameEn}" | Volume: "${variantVol}"`);
            console.log(`   - Original Source Stock : ${currentBaseUnits} base units`);
            console.log(`   - 100% Transfer Quantity: ${transferBaseUnits} base units (${transferPacks} packs/units)`);
            console.log(`   - Remaining Source Stock: ${newSourceBaseUnits} base units`);

            // 1. Update Source InventoryStock (Sets stock in Master Godown to 0)
            await stock.update({ totalBaseUnits: newSourceBaseUnits }, { transaction: t });

            // 2. Find or Create Destination InventoryStock (Adds 100% stock to Varachha Godown)
            let destStock = await InventoryStock.findOne({
                where: {
                    godownId: toGodownId,
                    productId: stock.productId,
                    variantId: stock.variantId
                },
                transaction: t
            });

            let newDestBaseUnits = 0;
            if (destStock) {
                newDestBaseUnits = Number(destStock.totalBaseUnits || 0) + transferBaseUnits;
                await destStock.update({ totalBaseUnits: newDestBaseUnits }, { transaction: t });
            } else {
                newDestBaseUnits = transferBaseUnits;
                destStock = await InventoryStock.create({
                    productId: stock.productId,
                    variantId: stock.variantId,
                    godownId: toGodownId,
                    primaryUnitId: stock.primaryUnitId,
                    secondaryUnitId: stock.secondaryUnitId,
                    secondaryPerPrimary: stock.secondaryPerPrimary,
                    totalBaseUnits: newDestBaseUnits,
                    avgPurchasePricePerBaseUnit: stock.avgPurchasePricePerBaseUnit || 0,
                    lastPurchasePricePerBaseUnit: stock.lastPurchasePricePerBaseUnit || 0,
                    status: 'Active'
                }, { transaction: t });
            }

            // 3. Create StockTransferItem
            await StockTransferItem.create({
                stockTransferId: transferRecord.id,
                productId: stock.productId,
                variantId: stock.variantId,
                qty: transferPacks,
                price: pricePerPack,
                amount: itemTotalAmount
            }, { transaction: t });

            // 4. Create Outgoing InventoryTransaction for Source Godown
            await InventoryTransaction.create({
                stockId: stock.id,
                productId: stock.productId,
                variantId: stock.variantId,
                godownId: fromGodownId,
                type: 'ADJUSTMENT',
                primaryUnitId: stock.primaryUnitId,
                secondaryUnitId: stock.secondaryUnitId,
                secondaryPerPrimary: stock.secondaryPerPrimary,
                qtyPrimary: 0,
                qtySecondary: 0,
                totalQtyBaseUnits: -transferBaseUnits,
                avgPriceAfterTxn: stock.avgPurchasePricePerBaseUnit || 0,
                balanceAfterBaseUnits: newSourceBaseUnits,
                note: `Automated 100% Full Transfer Out to ${toGodown.name} (TRF: ${transferNo})`,
                createdBy: 'System (100% Full Auto Transfer Script)'
            }, { transaction: t });

            // 5. Create Incoming InventoryTransaction for Destination Godown
            await InventoryTransaction.create({
                stockId: destStock.id,
                productId: stock.productId,
                variantId: stock.variantId,
                godownId: toGodownId,
                type: 'ADJUSTMENT',
                primaryUnitId: stock.primaryUnitId,
                secondaryUnitId: stock.secondaryUnitId,
                secondaryPerPrimary: stock.secondaryPerPrimary,
                qtyPrimary: 0,
                qtySecondary: 0,
                totalQtyBaseUnits: transferBaseUnits,
                avgPriceAfterTxn: destStock.avgPurchasePricePerBaseUnit || 0,
                balanceAfterBaseUnits: newDestBaseUnits,
                note: `Automated 100% Full Transfer In from ${fromGodown.name} (TRF: ${transferNo})`,
                createdBy: 'System (100% Full Auto Transfer Script)'
            }, { transaction: t });

            processedCount++;
        }

        // Update overall total amount of transfer
        await transferRecord.update({ totalAmount: grandTotalValue }, { transaction: t });

        if (isDryRun) {
            await t.rollback();
            console.log('\n===========================================================');
            console.log(`[DRY-RUN COMPLETE] Successfully simulated 100% full transfer of ${processedCount} variant(s).`);
            console.log(`Total Estimated Value: ₹${grandTotalValue.toFixed(2)}`);
            console.log('No database changes were saved (transaction rolled back).');
            console.log('===========================================================');
        } else {
            await t.commit();
            console.log('\n===========================================================');
            console.log(`[SUCCESS] Transferred 100% ALL stock for ${processedCount} variant(s).`);
            console.log(`Transfer Reference No: ${transferNo}`);
            console.log(`Total Transfer Value : ₹${grandTotalValue.toFixed(2)}`);
            console.log('All stock records and audit transactions committed to database. ✓');
            console.log('===========================================================');
        }
    } catch (error) {
        await t.rollback();
        console.error('\n[FATAL ERROR] 100% stock transfer failed. Transaction rolled back completely.');
        console.error('Error Details:', error);
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

transferStock().catch(e => {
    console.error('[UNHANDLED REJECTION]', e);
    process.exit(1);
});
