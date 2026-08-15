import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';

async function updateCustomSalesVolumeToLowest() {
    try {
        console.log('================================================================');
        console.log(' 🚀 UPDATE SCRIPT: SET LOWEST VOLUME AS CUSTOM SALES VOLUME');
        console.log('================================================================');
        console.log('[Script] Authenticating database connection...');
        await sequelize.authenticate();
        console.log('[Script] Connected to database successfully.\n');

        // Ensure customSalesVolumeId column exists on products table
        await sequelize.query(`
            ALTER TABLE products ADD COLUMN IF NOT EXISTS "customSalesVolumeId" UUID REFERENCES volumes(id) ON DELETE SET NULL;
        `);

        // Fetch all non-deleted products and their variants & volume units
        const [rows] = await sequelize.query(`
            SELECT 
                p.id AS "productId",
                p.name AS "productName",
                p."customSalesVolumeId",
                pv.id AS "variantId",
                pv."volume" AS "variantVolume",
                pv."baseUnitsPerPack",
                pv."baseUnitLabel",
                pv."innerUnitLabel",
                pv."volumeId",
                v_base.name AS "baseUnitName",
                v_inner.name AS "innerUnitName",
                v_vol.name AS "volumeName"
            FROM products p
            INNER JOIN product_variants pv ON pv."productId" = p.id AND (pv."deletedAt" IS NULL AND (pv.status IS NULL OR pv.status != 'Deleted'))
            LEFT JOIN volumes v_base ON v_base.id = pv."baseUnitLabel"
            LEFT JOIN volumes v_inner ON v_inner.id = pv."innerUnitLabel"
            LEFT JOIN volumes v_vol ON v_vol.id = pv."volumeId"
            WHERE p."deletedAt" IS NULL AND (p.status IS NULL OR p.status != 'Deleted')
            ORDER BY p.name ASC;
        `);

        const parseName = (nameObj) => {
            if (!nameObj) return '';
            if (typeof nameObj === 'string') {
                try {
                    const parsed = JSON.parse(nameObj);
                    return parsed.gu || parsed.GU || parsed.en || parsed.EN || Object.values(parsed)[0] || nameObj;
                } catch (e) {
                    return nameObj;
                }
            }
            return nameObj.gu || nameObj.GU || nameObj.en || nameObj.EN || Object.values(nameObj)[0] || '';
        };

        // Group variants by product
        const productsMap = new Map();
        for (const row of rows) {
            if (!productsMap.has(row.productId)) {
                productsMap.set(row.productId, {
                    productId: row.productId,
                    productName: parseName(row.productName),
                    currentCustomSalesVolumeId: row.customSalesVolumeId,
                    variants: []
                });
            }
            productsMap.get(row.productId).variants.push(row);
        }

        console.log(`[Script] Total products to update: ${productsMap.size}\n`);

        let updatedProductsCount = 0;
        let skippedProductsCount = 0;

        for (const [pId, prod] of productsMap.entries()) {
            const variants = prod.variants;

            let lowestVolumeId = null;
            let lowestVolumeName = '';

            // 1. Look for innerUnitLabel across variants
            const variantWithInner = variants.find(v => v.innerUnitLabel);
            if (variantWithInner && variantWithInner.innerUnitLabel) {
                lowestVolumeId = variantWithInner.innerUnitLabel;
                lowestVolumeName = parseName(variantWithInner.innerUnitName);
            }

            // 2. If no innerUnitLabel, sort by baseUnitsPerPack ASC
            if (!lowestVolumeId) {
                const sorted = [...variants].sort((a, b) => Number(a.baseUnitsPerPack || 1) - Number(b.baseUnitsPerPack || 1));
                const smallestVar = sorted[0];
                lowestVolumeId = smallestVar.baseUnitLabel || smallestVar.volumeId;
                lowestVolumeName = parseName(smallestVar.baseUnitName) || parseName(smallestVar.volumeName) || smallestVar.variantVolume || 'Unit';
            }

            if (!lowestVolumeId) {
                skippedProductsCount++;
                continue;
            }

            // UPDATE ONLY customSalesVolumeId on products table
            await sequelize.query(`
                UPDATE products
                SET "customSalesVolumeId" = :lowestVolumeId,
                    "updatedAt" = NOW()
                WHERE id = :pId;
            `, {
                replacements: { lowestVolumeId, pId }
            });

            updatedProductsCount++;
            console.log(`✓ [Updated ${updatedProductsCount}/${productsMap.size}] "${prod.productName}" => Custom Sales Volume: "${lowestVolumeName}" (${lowestVolumeId})`);
        }

        console.log('\n================================================================');
        console.log('🎉 CUSTOM SALES VOLUME UPDATE COMPLETE!');
        console.log(`   - Total Products Processed: ${productsMap.size}`);
        console.log(`   - Total Products Updated: ${updatedProductsCount}`);
        console.log(`   - Total Products Skipped: ${skippedProductsCount}`);
        console.log('================================================================\n');

    } catch (err) {
        console.error('❌ Error during update script:', err);
    } finally {
        await sequelize.close();
        console.log('[Script] Database connection closed.');
    }
}

updateCustomSalesVolumeToLowest();
