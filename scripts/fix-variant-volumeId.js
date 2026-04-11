/**
 * One-time migration: Backfill volumeId for old product_variants records
 *
 * Problem: older production records were created before the volumeId column was added,
 * so they have volumeId = NULL but store the unit name inside the `volume` field (e.g. "10 ml").
 *
 * Fix: parse the unit name from the `volume` string, match it against all rows in the
 * `volumes` table (checking every language in the JSONB `name` field), then update.
 *
 * Run once on production:
 *   node scripts/fix-variant-volumeId.js
 */

import sequelize from '../config/db.js';

async function run() {
    try {
        console.log('🔗 Connecting to database...');
        await sequelize.authenticate();
        console.log('✅ Connected.\n');

        // 1. Fetch all volumes
        const [volumes] = await sequelize.query(
            `SELECT id, name FROM volumes WHERE "deletedAt" IS NULL`
        );
        console.log(`📦 Found ${volumes.length} volumes in DB.\n`);

        if (!volumes.length) {
            console.log('⚠️  No volumes found. Exiting.');
            process.exit(0);
        }

        // 2. Fetch all variants that have volumeId = NULL
        const [variants] = await sequelize.query(
            `SELECT id, volume FROM product_variants WHERE "volumeId" IS NULL AND "deletedAt" IS NULL`
        );
        console.log(`🔍 Found ${variants.length} variants with NULL volumeId.\n`);

        if (!variants.length) {
            console.log('✅ Nothing to fix. All variants already have volumeId set.');
            process.exit(0);
        }

        let fixed = 0;
        let skipped = 0;

        for (const variant of variants) {
            // Parse unit name from e.g. "10 ml" => "ml", "500 gram" => "gram", "Dando" => "Dando"
            const volumeStr = String(variant.volume || '').trim();
            const match = volumeStr.match(/^[\d.]+\s*(.+)$/) || volumeStr.match(/^([a-zA-Z].*)$/);
            const unitName = match ? match[1].trim().toLowerCase() : '';

            if (!unitName) {
                console.warn(`  ⚠️  Variant ${variant.id}: cannot parse unit from "${volumeStr}" — skipping`);
                skipped++;
                continue;
            }

            // Find matching volume by checking all language values in JSONB name
            const matched = volumes.find((vol) => {
                const nameObj = typeof vol.name === 'string' ? JSON.parse(vol.name) : vol.name;
                return Object.values(nameObj || {}).some(
                    (n) => String(n || '').trim().toLowerCase() === unitName
                );
            });

            if (!matched) {
                console.warn(`  ⚠️  Variant ${variant.id}: no volume matched for unit "${unitName}" (volume="${volumeStr}") — skipping`);
                skipped++;
                continue;
            }

            await sequelize.query(
                `UPDATE product_variants SET "volumeId" = :volumeId WHERE id = :id`,
                { replacements: { volumeId: matched.id, id: variant.id } }
            );

            console.log(`  ✅ Fixed variant ${variant.id}: "${volumeStr}" → volumeId = ${matched.id}`);
            fixed++;
        }

        console.log(`\n🎉 Done! Fixed: ${fixed} | Skipped: ${skipped}`);
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration error:', err.message);
        console.error(err);
        process.exit(1);
    }
}

run();
