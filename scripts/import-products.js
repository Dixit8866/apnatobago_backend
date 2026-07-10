import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables first
dotenv.config();

import sequelize, { connectDB } from '../config/db.js';
import { Product, MainCategory, SubCategory, CompanyCategory } from '../models/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_PATH = path.join(__dirname, 'products.json');

const importProducts = async () => {
    try {
        console.log(`[Import] Reading local products.json file...`);
        if (!fs.existsSync(JSON_PATH)) {
            throw new Error(`JSON file not found at path: ${JSON_PATH}`);
        }

        const dataStr = fs.readFileSync(JSON_PATH, 'utf-8');
        const products = JSON.parse(dataStr);

        console.log(`[Import] Loaded ${products.length} products to seed.`);

        // Connect to the DB
        await connectDB();

        console.log('[Import] Seeding database...');
        let successCount = 0;
        let failCount = 0;

        for (const item of products) {
            try {
                // 1. Ensure MainCategory exists
                if (item.mainCategoryId) {
                    await MainCategory.findOrCreate({
                        where: { id: item.mainCategoryId },
                        defaults: {
                            id: item.mainCategoryId,
                            title: { en: 'Imported Category', gu: 'આયાતી શ્રેણી' },
                            thumbnail: 'https://via.placeholder.com/150',
                            status: 'Active'
                        }
                    });
                }

                // 2. Ensure SubCategory exists
                if (item.subCategoryId) {
                    await SubCategory.findOrCreate({
                        where: { id: item.subCategoryId },
                        defaults: {
                            id: item.subCategoryId,
                            title: { en: 'Imported Subcategory', gu: 'આયાતી પેટાશ્રેણી' },
                            mainCategoryId: item.mainCategoryId,
                            status: 'Active'
                        }
                    });
                }

                // 3. Ensure CompanyCategory exists
                if (item.companyCategoryId) {
                    await CompanyCategory.findOrCreate({
                        where: { id: item.companyCategoryId },
                        defaults: {
                            id: item.companyCategoryId,
                            title: { en: 'Imported Company', gu: 'આયાતી કંપની' },
                            subCategoryId: item.subCategoryId,
                            status: 'Active'
                        }
                    });
                }

                // Ensure dates are converted back to Date objects or kept null
                const productRecord = {
                    ...item,
                    createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
                    updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
                    deletedAt: item.deletedAt ? new Date(item.deletedAt) : null
                };

                // Upsert into DB
                await Product.upsert(productRecord);
                successCount++;

                if (successCount % 50 === 0) {
                    console.log(`[Import] Progress: Imported ${successCount} products...`);
                }
            } catch (err) {
                console.error(`[Import Error] Failed at product ${item.id} (${item.name?.en || 'Unknown'}):`, err.message);
                failCount++;
            }
        }

        console.log(`\n[Import Complete] Successfully imported/updated ${successCount} products. Failures: ${failCount}`);
        process.exit(0);
    } catch (err) {
        console.error('[Import Fatal Error]:', err.message);
        process.exit(1);
    }
};

importProducts();
