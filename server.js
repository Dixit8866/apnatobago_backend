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
