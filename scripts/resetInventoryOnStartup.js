import sequelize from '../config/db.js';

/**
 * resetInventoryOnStartup
 * ─────────────────────────────────────────────────────────────────────────────
 * PM2 restart / production startup per badha inventory_stocks records ni
 * totalBaseUnits = 0 kari de che.
 *
 * NOTE: Rows DELETE thata nathi — sirf stock quantity reset thay che.
 *       Product, variant, godown assignments safe rahe che.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const resetInventoryOnStartup = async () => {
    try {
        const [result] = await sequelize.query(
            `UPDATE inventory_stocks
             SET    "totalBaseUnits"               = 0,
                    "avgPurchasePricePerBaseUnit"   = 0,
                    "lastPurchasePricePerBaseUnit"  = 0,
                    "updatedAt"                    = NOW()
             WHERE  "deletedAt" IS NULL`
        );

        // PostgreSQL UPDATE returns rowCount on the result object
        const affected = result?.rowCount ?? result?.affectedRows ?? '?';
        console.log(`[Startup] Inventory reset complete — ${affected} stock record(s) set to 0 ✓`);
    } catch (error) {
        // Non-fatal: log and continue — do NOT crash the server
        console.error('[Startup] Inventory reset FAILED:', error.message);
    }
};
