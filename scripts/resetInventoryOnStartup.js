import sequelize from '../config/db.js';
import Product from '../models/superadmin-models/Product.js';
import ProductVariant from '../models/superadmin-models/ProductVariant.js';
import Volume from '../models/superadmin-models/Volume.js';
import Godown from '../models/superadmin-models/Godown.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';

/**
 * resetInventoryOnStartup
 * ─────────────────────────────────────────────────────────────────────────────
 * Server startup / PM2 restart per badha active products na badha variants mapping ma
 * totalBaseUnits = 100 set/seed kari de che.
 *
 * NOTE: Production-safe update schema.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const resetInventoryOnStartup = async () => {
    try {
        console.log('[Startup] Starting inventory setup/update to 100...');

        // 1. Update all existing non-deleted stocks to 100
        const [result] = await sequelize.query(
            `UPDATE inventory_stocks
             SET    "totalBaseUnits"               = 100,
                    "updatedAt"                    = NOW()
             WHERE  "deletedAt" IS NULL`
        );
        const affected = result?.rowCount ?? result?.affectedRows ?? '?';
        console.log(`[Startup] Updated ${affected} existing stock records to 100 ✓`);

        // 2. Resolve default Godown (Active)
        let godown = await Godown.findOne({ where: { status: 'Active' } });
        if (!godown) {
            godown = await Godown.create({ name: 'Main Godown', type: 'Main', status: 'Active' });
            console.log(`[Startup] Created missing default Active Godown: ${godown.name}`);
        }

        // 3. Resolve default Volume (Active) for primaryUnitId
        let defaultVolume = await Volume.findOne({ where: { status: 'Active' } });
        if (!defaultVolume) {
            defaultVolume = await Volume.create({ name: { en: 'pcs' }, status: 'Active' });
            console.log(`[Startup] Created missing default Active Volume: pcs`);
        }

        // 4. Fetch all active products and their active variants
        const products = await Product.findAll({
            where: { status: 'Active' },
            include: [{
                model: ProductVariant,
                as: 'variants',
                where: { status: 'Active' }
            }]
        });

        console.log(`[Startup] Found ${products.length} active products to check variants...`);

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
                        totalBaseUnits: 100,
                        avgPurchasePricePerBaseUnit: variant.purchasePrice || 0,
                        lastPurchasePricePerBaseUnit: variant.purchasePrice || 0,
                        status: 'Active'
                    }
                });

                if (created) {
                    newRecordsCreated++;
                } else if (stock.totalBaseUnits !== 100) {
                    stock.totalBaseUnits = 100;
                    await stock.save();
                    recordsUpdated++;
                }
            }
        }

        console.log(`[Startup] Inventory check complete! ${newRecordsCreated} new stock records created, ${recordsUpdated} existing stock records synchronized to 100.`);
    } catch (error) {
        // Non-fatal: log and continue — do NOT crash the server
        console.error('[Startup] Inventory seeding FAILED:', error.stack || error.message);
    }
};
