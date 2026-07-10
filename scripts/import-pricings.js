import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables first
dotenv.config();

import sequelize, { connectDB } from '../config/db.js';
import { ProductPricing, ProductVariant, CustomLevel, Product, Volume } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_PATH = path.join(__dirname, 'product-pricings.json');

const ensureCustomLevelExists = async (customLevelId) => {
    if (!customLevelId) return;
    const lvl = await CustomLevel.findByPk(customLevelId);
    if (!lvl) {
        await CustomLevel.create({
            id: customLevelId,
            name: 'Imported Level',
            status: 'Active'
        });
        console.log(`[Import] Created placeholder CustomLevel: ${customLevelId}`);
    }
};

const ensureVariantExists = async (variantId) => {
    if (!variantId) return;
    const variant = await ProductVariant.findByPk(variantId);
    if (!variant) {
        const prod = await Product.findOne();
        const vol = await Volume.findOne();

        await ProductVariant.create({
            id: variantId,
            productId: prod?.id || '00000000-0000-0000-0000-000000000000',
            volumeId: vol?.id || null,
            volume: '1',
            purchasePrice: 0,
            status: 'Active'
        });
        console.log(`[Import] Created placeholder ProductVariant: ${variantId}`);
    }
};

const importPricings = async () => {
    try {
        console.log(`[Import] Reading local product-pricings.json file...`);
        if (!fs.existsSync(JSON_PATH)) {
            throw new Error(`JSON file not found at path: ${JSON_PATH}`);
        }

        const dataStr = fs.readFileSync(JSON_PATH, 'utf-8');
        const pricings = JSON.parse(dataStr);

        console.log(`[Import] Loaded ${pricings.length} product pricings to seed.`);

        // Connect to the DB
        await connectDB();

        console.log('[Import] Seeding product pricings...');
        let successCount = 0;
        let failCount = 0;

        for (const item of pricings) {
            try {
                // Ensure foreign keys exist
                await ensureVariantExists(item.variantId);
                await ensureCustomLevelExists(item.customLevelId);

                const pricingRecord = {
                    ...item,
                    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
                    updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
                    deletedAt: item.deletedAt ? new Date(item.deletedAt) : null
                };

                // Upsert into DB
                await ProductPricing.upsert(pricingRecord);
                successCount++;

                if (successCount % 500 === 0) {
                    console.log(`[Import] Progress: Imported ${successCount} pricings...`);
                }
            } catch (err) {
                console.error(`[Import Error] Failed at pricing ${item.id} (variantId: ${item.variantId}):`, err.message);
                if (err.errors) {
                    console.error('Validation details:', err.errors.map(e => ({ message: e.message, path: e.path, value: e.value })));
                }
                failCount++;
            }
        }

        console.log(`\n[Import Complete] Successfully imported/updated ${successCount} product pricings. Failures: ${failCount}`);
        process.exit(0);
    } catch (err) {
        console.error('[Import Fatal Error]:', err.message);
        process.exit(1);
    }
};

importPricings();
