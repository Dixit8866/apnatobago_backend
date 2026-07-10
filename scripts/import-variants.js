import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables first
dotenv.config();

import sequelize, { connectDB } from '../config/db.js';
import { ProductVariant, Product, Volume, MainCategory, SubCategory, CompanyCategory } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_PATH = path.join(__dirname, 'product-variants.json');

const ensureProductExists = async (productId) => {
    if (!productId) return;
    const prod = await Product.findByPk(productId);
    if (!prod) {
        const mainCat = await MainCategory.findOne();
        const subCat = await SubCategory.findOne();
        const compCat = await CompanyCategory.findOne();

        await Product.create({
            id: productId,
            thumbnail: 'https://via.placeholder.com/150',
            name: { en: 'Imported Product Placeholder', gu: 'આયાતી પ્રોડક્ટ પ્લેસહોલ્ડર' },
            mainCategoryId: mainCat?.id || '00000000-0000-0000-0000-000000000000',
            subCategoryId: subCat?.id || '00000000-0000-0000-0000-000000000000',
            companyCategoryId: compCat?.id || '00000000-0000-0000-0000-000000000000',
            status: 'Active'
        });
        console.log(`[Import] Created placeholder product for missing references: ${productId}`);
    }
};

const ensureVolumeExists = async (volumeId) => {
    if (!volumeId) return;
    const vol = await Volume.findByPk(volumeId);
    if (!vol) {
        await Volume.create({
            id: volumeId,
            name: { en: 'Imported Volume', gu: 'આયાતી વોલ્યુમ' },
            status: 'Active'
        });
        console.log(`[Import] Created placeholder volume for missing references: ${volumeId}`);
    }
};

const importVariants = async () => {
    try {
        console.log(`[Import] Reading local product-variants.json file...`);
        if (!fs.existsSync(JSON_PATH)) {
            throw new Error(`JSON file not found at path: ${JSON_PATH}`);
        }

        const dataStr = fs.readFileSync(JSON_PATH, 'utf-8');
        const variants = JSON.parse(dataStr);

        console.log(`[Import] Loaded ${variants.length} product variants to seed.`);

        // Connect to the DB
        await connectDB();

        console.log('[Import] Seeding variants database...');
        let successCount = 0;
        let failCount = 0;

        for (const item of variants) {
            try {
                // Ensure foreign keys exist
                await ensureProductExists(item.productId);
                await ensureVolumeExists(item.volumeId);
                await ensureVolumeExists(item.baseUnitLabel);
                await ensureVolumeExists(item.innerUnitLabel);

                const variantRecord = {
                    ...item,
                    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
                    updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
                    deletedAt: item.deletedAt ? new Date(item.deletedAt) : null
                };

                // Upsert into DB
                await ProductVariant.upsert(variantRecord);
                successCount++;

                if (successCount % 100 === 0) {
                    console.log(`[Import] Progress: Imported ${successCount} variants...`);
                }
            } catch (err) {
                console.error(`[Import Error] Failed at variant ${item.id} (volume: ${item.volume}):`, err.message);
                failCount++;
            }
        }

        console.log(`\n[Import Complete] Successfully imported/updated ${successCount} variants. Failures: ${failCount}`);
        process.exit(0);
    } catch (err) {
        console.error('[Import Fatal Error]:', err.message);
        process.exit(1);
    }
};

importVariants();
