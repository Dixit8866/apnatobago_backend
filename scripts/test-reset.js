import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import { Product, ProductVariant, Volume, Godown, InventoryStock, InventoryTransaction } from '../models/index.js';

async function main() {
    const t = await sequelize.transaction();
    try {
        console.log('[Reset] Connecting to database...');
        await sequelize.authenticate();
        console.log('[Reset] Database connected successfully.');

        // 1. Delete all transactions history
        console.log('[Reset] Deleting all inventory transactions...');
        await InventoryTransaction.destroy({ where: {}, force: true, transaction: t });
        console.log('[Reset] All inventory transactions deleted.');

        // 2. Reset all existing stock quantities, prices, etc. to 0
        console.log('[Reset] Setting all existing stocks to 0...');
        await InventoryStock.update(
            {
                totalBaseUnits: 0,
                avgPurchasePricePerBaseUnit: 0,
                lastPurchasePricePerBaseUnit: 0
            },
            {
                where: {},
                transaction: t
            }
        );
        console.log('[Reset] All existing stocks updated to 0.');

        // 3. Resolve default Godown (Active)
        let godown = await Godown.findOne({ where: { status: 'Active' }, transaction: t });
        if (!godown) {
            godown = await Godown.create({ name: 'Main Godown', type: 'Main', status: 'Active' }, { transaction: t });
            console.log(`[Reset] Created default Active Godown: ${godown.name}`);
        }

        // 4. Resolve default Volume (Active) for primaryUnitId
        let defaultVolume = await Volume.findOne({ where: { status: 'Active' }, transaction: t });
        if (!defaultVolume) {
            defaultVolume = await Volume.create({ name: { en: 'pcs' }, status: 'Active' }, { transaction: t });
            console.log(`[Reset] Created default Active Volume: pcs`);
        }

        // 5. Fetch all active products and variants to ensure they have stock records initialized to 0
        const products = await Product.findAll({
            where: { status: 'Active' },
            include: [{
                model: ProductVariant,
                as: 'variants',
                where: { status: 'Active' }
            }],
            transaction: t
        });

        console.log(`[Reset] Found ${products.length} active products to check variants...`);

        let newRecordsCreated = 0;
        let recordsUpdated = 0;

        for (const product of products) {
            if (!product.variants || product.variants.length === 0) continue;

            for (const variant of product.variants) {
                const primaryUnitId = variant.baseUnitLabel || variant.volumeId || defaultVolume.id;

                const [stock, created] = await InventoryStock.findOrCreate({
                    where: {
                        productId: product.id,
                        variantId: variant.id,
                        godownId: godown.id
                    },
                    defaults: {
                        primaryUnitId,
                        secondaryUnitId: null,
                        secondaryPerPrimary: 1,
                        totalBaseUnits: 0,
                        avgPurchasePricePerBaseUnit: 0,
                        lastPurchasePricePerBaseUnit: 0,
                        status: 'Active'
                    },
                    transaction: t
                });

                if (created) {
                    newRecordsCreated++;
                } else {
                    if (stock.totalBaseUnits !== 0 || Number(stock.avgPurchasePricePerBaseUnit) !== 0 || Number(stock.lastPurchasePricePerBaseUnit) !== 0) {
                        stock.totalBaseUnits = 0;
                        stock.avgPurchasePricePerBaseUnit = 0;
                        stock.lastPurchasePricePerBaseUnit = 0;
                        await stock.save({ transaction: t });
                        recordsUpdated++;
                    }
                }
            }
        }

        await t.commit();
        console.log(`[Reset] Complete! ${newRecordsCreated} new stock records created, ${recordsUpdated} existing stock records synchronized to 0.`);

    } catch (error) {
        await t.rollback();
        console.error('[Reset Failed] Error:', error.message || error);
    } finally {
        await sequelize.close();
        console.log('[Reset] Database connection closed.');
    }
}

main();
