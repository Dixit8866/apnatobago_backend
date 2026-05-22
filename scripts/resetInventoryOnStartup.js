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
        console.log('[Startup] Starting inventory setup/update to 0...');

        // 1. Update all existing non-deleted stocks to 0
        const [result] = await sequelize.query(
            `UPDATE inventory_stocks
             SET    "totalBaseUnits"               = 0,
                    "updatedAt"                    = NOW()
             WHERE  "deletedAt" IS NULL`
        );
        const affected = result?.rowCount ?? result?.affectedRows ?? '?';
        console.log(`[Startup] Updated ${affected} existing stock records to 0 ✓`);

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
                const bUPP = Number(variant.baseUnitsPerPack || 1);
                const defaultBasePrice = Number(variant.purchasePrice || 0) / bUPP;

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
                        avgPurchasePricePerBaseUnit: defaultBasePrice,
                        lastPurchasePricePerBaseUnit: defaultBasePrice,
                        status: 'Active'
                    }
                });

                if (created) {
                    newRecordsCreated++;
                } else {
                    stock.totalBaseUnits = 0;
                    stock.avgPurchasePricePerBaseUnit = defaultBasePrice;
                    stock.lastPurchasePricePerBaseUnit = defaultBasePrice;
                    await stock.save();
                    recordsUpdated++;
                }
            }
        }

        console.log(`[Startup] Inventory check complete! ${newRecordsCreated} new stock records created, ${recordsUpdated} existing stock records synchronized to 0.`);
    } catch (error) {
        // Non-fatal: log and continue — do NOT crash the server
        console.error('[Startup] Inventory seeding FAILED:', error.stack || error.message);
    }
};
