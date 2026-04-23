import http from 'http';
import app from './app.js';
import sequelize, { connectDB } from './config/db.js';
import './models/index.js'; // Import models to ensure all associations are registered before sync

// Setup Port
const PORT = process.env.PORT || 5000;

// Create HTTP server
const server = http.createServer(app);

// ─── Auto Migration: Backfill volumeId for old product_variants records ──────
// Runs every startup — safe/idempotent (only updates rows where volumeId IS NULL)
// Needed for production records created before volumeId column was added.
async function runAutoMigrations() {
    try {
        // Fetch all volumes (id + multilingual name)
        const [volumes] = await sequelize.query(
            `SELECT id, name FROM volumes WHERE "deletedAt" IS NULL`
        );

        if (!volumes.length) return;

        // Fetch only variants that still have NULL volumeId
        const [variants] = await sequelize.query(
            `SELECT id, volume FROM product_variants WHERE "volumeId" IS NULL AND "deletedAt" IS NULL`
        );

        if (!variants.length) {
            console.log('[AutoMigrate] product_variants: all volumeId fields are already set ✓');
            return;
        }

        console.log(`[AutoMigrate] Backfilling volumeId for ${variants.length} product_variants...`);

        let fixed = 0;
        let skipped = 0;

        for (const variant of variants) {
            const volumeStr = String(variant.volume || '').trim();
            // Match "10 ml" => "ml", "500 gram" => "gram", "Dando" => "dando"
            const match =
                volumeStr.match(/^[\d.]+\s*(.+)$/) ||
                volumeStr.match(/^([a-zA-Z].*)$/);
            const unitName = match ? match[1].trim().toLowerCase() : '';

            if (!unitName) { skipped++; continue; }

            const matched = volumes.find((vol) => {
                const nameObj = typeof vol.name === 'string' ? JSON.parse(vol.name) : vol.name;
                return Object.values(nameObj || {}).some(
                    (n) => String(n || '').trim().toLowerCase() === unitName
                );
            });

            if (!matched) { skipped++; continue; }

            await sequelize.query(
                `UPDATE product_variants SET "volumeId" = :volumeId WHERE id = :id`,
                { replacements: { volumeId: matched.id, id: variant.id } }
            );
            fixed++;
        }
        console.log(`[AutoMigrate] product_variants volumeId backfill done — Fixed: ${fixed} | Skipped: ${skipped}`);

        // ─── 3. Auto Seed: Backfill ProductVariant.baseUnit* ──────────────────────
        const [varUnit1] = await sequelize.query(`
            UPDATE product_variants 
            SET "baseUnitLabel" = 'pcs'
            WHERE "baseUnitLabel" IS NULL OR "baseUnitLabel" = ''
            RETURNING id;
        `);
        if (varUnit1 && varUnit1.length) {
            console.log(`[AutoSeed] Seeded baseUnitLabel='pcs' for ${varUnit1.length} variants ✓`);
        }

        const [varUnit2] = await sequelize.query(`
            UPDATE product_variants 
            SET "baseUnitsPerPack" = 1
            WHERE "baseUnitsPerPack" IS NULL
            RETURNING id;
        `);
        if (varUnit2 && varUnit2.length) {
            console.log(`[AutoSeed] Seeded baseUnitsPerPack=1 for ${varUnit2.length} variants ✓`);
        }

        // ─── 4. Auto Migration: Add lastPurchasePricePerBaseUnit to inventory_stocks ──
        try {
            console.log('[AutoMigrate] Checking inventory_stocks columns...');
            const [columnCheck] = await sequelize.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'inventory_stocks' AND column_name = 'lastPurchasePricePerBaseUnit'
            `);
            console.log(`[AutoMigrate] Column check result: ${columnCheck.length} columns found`);
            if (!columnCheck.length) {
                console.log('[AutoMigrate] Adding lastPurchasePricePerBaseUnit column...');
                await sequelize.query(`
                    ALTER TABLE inventory_stocks 
                    ADD COLUMN "lastPurchasePricePerBaseUnit" DECIMAL(12, 2) NOT NULL DEFAULT 0
                `);
                console.log('[AutoMigrate] Added lastPurchasePricePerBaseUnit column to inventory_stocks ✓');
            } else {
                // Column exists, ensure no NULL values
                console.log('[AutoMigrate] Checking for NULL values...');
                const [nullRows] = await sequelize.query(`
                    SELECT COUNT(*) as count FROM inventory_stocks 
                    WHERE "lastPurchasePricePerBaseUnit" IS NULL
                `);
                console.log(`[AutoMigrate] NULL rows found: ${nullRows[0].count}`);
                if (nullRows[0].count > 0) {
                    await sequelize.query(`
                        UPDATE inventory_stocks 
                        SET "lastPurchasePricePerBaseUnit" = COALESCE("avgPurchasePricePerBaseUnit", 0)
                        WHERE "lastPurchasePricePerBaseUnit" IS NULL
                    `);
                    console.log(`[AutoMigrate] Fixed ${nullRows[0].count} rows with NULL lastPurchasePricePerBaseUnit ✓`);
                }
            }
        } catch (colErr) {
            console.warn('[AutoMigrate] Warning: Could not add/fix column:', colErr.message);
            console.warn('[AutoMigrate] Error stack:', colErr.stack);
        }

        // ─── 5. Auto Migration: Drop unique constraint for batch tracking ────────────
        try {
            // Check if any unique constraint exists (excluding primary key)
            const [constraintCheck] = await sequelize.query(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'inventory_stocks' 
                AND constraint_type = 'UNIQUE'
                AND constraint_name NOT LIKE '%pkey%'
            `);
            if (constraintCheck.length) {
                for (const constraint of constraintCheck) {
                    await sequelize.query(`
                        ALTER TABLE inventory_stocks 
                        DROP CONSTRAINT IF EXISTS "${constraint.constraint_name}"
                    `);
                    console.log(`[AutoMigrate] Dropped unique constraint: ${constraint.constraint_name} ✓`);
                }
            }
        } catch (constraintErr) {
            console.warn('[AutoMigrate] Warning: Could not drop constraint:', constraintErr.message);
        }

        // ─── 6. Auto Seed: Backfill User.kycverification ──────────────────────────
        try {
            await sequelize.query(`
                UPDATE users 
                SET kycverification = 'pending' 
                WHERE kycverification IS NULL
            `);
            console.log('[AutoSeed] Backfilled kycverification for existing users ✓');
        } catch (userErr) {
            console.warn('[AutoSeed] Warning: User kycverification backfill failed:', userErr.message);
        }

    } catch (err) {
        // Never crash the server for a migration warning
        console.warn('[AutoMigrate] Warning: volumeId backfill failed (non-fatal):', err.message);
    }
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const startServer = async () => {
    try {
        // Connect to Database
        await connectDB();

        // Pre-sync: Drop any unique constraints/indexes on inventory_stocks BEFORE sync recreates them
        try {
            // Drop unique constraints
            const [constraints] = await sequelize.query(`
                SELECT constraint_name 
                FROM information_schema.table_constraints 
                WHERE table_name = 'inventory_stocks' 
                AND constraint_type = 'UNIQUE'
                AND constraint_name NOT LIKE '%pkey%'
            `);
            console.log(`[PreSync] Found ${constraints.length} unique constraints to drop`);
            for (const c of constraints) {
                await sequelize.query(`ALTER TABLE inventory_stocks DROP CONSTRAINT IF EXISTS "${c.constraint_name}"`);
                console.log(`[PreSync] Dropped unique constraint: ${c.constraint_name} ✓`);
            }
            
            // Drop unique indexes (PostgreSQL can have unique indexes without constraints)
            const [indexes] = await sequelize.query(`
                SELECT indexname 
                FROM pg_indexes 
                WHERE tablename = 'inventory_stocks' 
                AND indexdef LIKE '%UNIQUE%'
                AND indexname NOT LIKE '%pkey%'
            `);
            console.log(`[PreSync] Found ${indexes.length} unique indexes to drop`);
            for (const idx of indexes) {
                await sequelize.query(`DROP INDEX IF EXISTS "${idx.indexname}"`);
                console.log(`[PreSync] Dropped unique index: ${idx.indexname} ✓`);
            }
        } catch (e) {
            console.warn('[PreSync] Could not drop constraints/indexes:', e.message);
        }

        // Sync Sequelize Models with Database
        // Note: force: false won't drop existing tables. alter: { drop: false } adds new columns safely.
        await sequelize.sync({ force: false, alter: { drop: false } });
        console.log('[Database] Sequelize Models Synced');

        // Run auto migrations (safe, idempotent — only fixes NULL rows)
        await runAutoMigrations();

        server.listen(PORT, () => {
            console.log(`[Server] running in ${process.env.NODE_ENV} mode on port ${PORT}`);
        });
    } catch (error) {
        console.error(`[Server Error] Failed to start server:`, error.message);
        process.exit(1);
    }
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
    console.log(`[Error] Unhandled Rejection: ${err.message}`);
    server.close(() => process.exit(1));
});
