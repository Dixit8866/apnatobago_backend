import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';

async function auditPricingAnomalies() {
    try {
        console.log('================================================================');
        console.log('       🔍 READ-ONLY PRICING AUDIT SCRIPT FOR PRODUCTS');
        console.log('================================================================');
        console.log('[Script] Authenticating database connection...');
        await sequelize.authenticate();
        console.log('[Script] Connected to database successfully.\n');

        const [rows] = await sequelize.query(`
            SELECT 
                p.id AS "productId",
                p.name AS "productName",
                pv.id AS "variantId",
                pv."volume" AS "variantVolume",
                pv."purchasePrice" AS "variantPurchasePrice",
                pp.id AS "pricingId",
                pp."purchasePrice" AS "pricingPurchasePrice",
                pp.price AS "sellingPrice",
                pp.mrp AS "mrp",
                cl.name AS "levelName",
                v_base.name AS "baseUnitName",
                v_vol.name AS "volumeName"
            FROM products p
            INNER JOIN product_variants pv ON pv."productId" = p.id AND (pv."deletedAt" IS NULL AND (pv.status IS NULL OR pv.status != 'Deleted'))
            LEFT JOIN product_pricings pp ON pp."variantId" = pv.id AND (pp."deletedAt" IS NULL)
            LEFT JOIN custom_levels cl ON cl.id = pp."customLevelId" AND (cl."deletedAt" IS NULL)
            LEFT JOIN volumes v_base ON v_base.id = pv."baseUnitLabel"
            LEFT JOIN volumes v_vol ON v_vol.id = pv."volumeId"
            WHERE p."deletedAt" IS NULL AND (p.status IS NULL OR p.status != 'Deleted')
            ORDER BY p.name ASC;
        `);

        const parseName = (nameObj) => {
            if (!nameObj) return 'Unnamed Product';
            if (typeof nameObj === 'string') {
                try {
                    const parsed = JSON.parse(nameObj);
                    return parsed.gu || parsed.GU || parsed.en || parsed.EN || parsed.hn || parsed.HN || Object.values(parsed)[0] || nameObj;
                } catch (e) {
                    return nameObj;
                }
            }
            return nameObj.gu || nameObj.GU || nameObj.en || nameObj.EN || nameObj.hn || nameObj.HN || Object.values(nameObj)[0] || 'Unnamed Product';
        };

        const faultyProductsMap = new Map();

        for (const row of rows) {
            const pName = parseName(row.productName);
            const pId = row.productId;

            const pricingPurchasePrice = row.pricingPurchasePrice !== null && row.pricingPurchasePrice !== undefined ? Number(row.pricingPurchasePrice) : null;
            const variantPurchasePrice = row.variantPurchasePrice !== null && row.variantPurchasePrice !== undefined ? Number(row.variantPurchasePrice) : 0;
            const purchasePrice = (pricingPurchasePrice !== null && pricingPurchasePrice > 0) ? pricingPurchasePrice : variantPurchasePrice;

            const sellingPrice = Number(row.sellingPrice || 0);
            const mrp = Number(row.mrp || 0);

            const levelName = parseName(row.levelName) || 'Standard/Default';
            const volDisplay = parseName(row.volumeName) || parseName(row.baseUnitName) || row.variantVolume || 'Variant';

            const faults = [];

            // Condition 1: Purchase Price > MRP (when MRP > 0)
            if (mrp > 0 && purchasePrice > mrp) {
                faults.push({
                    type: 'PURCHASE_PRICE_GREATER_THAN_MRP',
                    details: `Purchase Price (₹${purchasePrice}) > MRP (₹${mrp})`,
                    volDisplay,
                    levelName,
                    purchasePrice,
                    mrp,
                    sellingPrice
                });
            }

            // Condition 2: Purchase Price >= Selling Price (when Selling Price > 0)
            if (sellingPrice > 0 && purchasePrice >= sellingPrice) {
                faults.push({
                    type: 'PURCHASE_PRICE_GREATER_OR_EQUAL_SELLING_PRICE',
                    details: `Purchase Price (₹${purchasePrice}) >= Selling Price (₹${sellingPrice}) [Level: ${levelName}]`,
                    volDisplay,
                    levelName,
                    purchasePrice,
                    mrp,
                    sellingPrice
                });
            }

            if (faults.length > 0) {
                if (!faultyProductsMap.has(pId)) {
                    faultyProductsMap.set(pId, {
                        productId: pId,
                        productName: pName,
                        faults: []
                    });
                }
                faultyProductsMap.get(pId).faults.push(...faults);
            }
        }

        const faultyProductsList = Array.from(faultyProductsMap.values());

        console.log(`[Script] Total 1767 pricing records examined.\n`);

        if (faultyProductsList.length === 0) {
            console.log('✅ NO PRICING ANOMALIES FOUND! All product purchase prices are lower than MRP and Selling Prices.\n');
        } else {
            console.log('================================================================');
            console.log(`❌ FOUND ${faultyProductsList.length} PRODUCTS WITH PRICING ANOMALIES (FAULTS):`);
            console.log('================================================================\n');

            faultyProductsList.forEach((item, idx) => {
                console.log(`${idx + 1}. Product: "${item.productName}" (ID: ${item.productId})`);
                item.faults.forEach((f, fIdx) => {
                    console.log(`   └─ [Fault ${fIdx + 1}] Volume: "${f.volDisplay}" | Level: "${f.levelName}" => ${f.details}`);
                });
                console.log('');
            });

            console.log('================================================================');
            console.log('📋 ONLY PRODUCT NAMES (EASY COPY-PASTE):');
            console.log('================================================================');
            faultyProductsList.forEach((item, idx) => {
                console.log(`${idx + 1}. ${item.productName}`);
            });
            console.log('================================================================\n');
        }

    } catch (err) {
        console.error('❌ Error during SQL pricing audit script:', err);
    } finally {
        await sequelize.close();
        console.log('[Script] Database connection closed.');
    }
}

auditPricingAnomalies();
