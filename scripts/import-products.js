import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables first
dotenv.config();

import sequelize, { connectDB } from '../config/db.js';
import { Product, MainCategory, SubCategory, CompanyCategory } from '../models/index.js';

const CSV_PATH = 'c:\\Users\\Admin\\Downloads\\products.csv';

// ─── Custom CSV Parser (RFC 4180 compliant) ──────────────────────────────────
function parseCSV(text) {
    let p = '', c = '', r = [];
    let q = false;
    let row = [''];
    for (let i = 0; i < text.length; i++) {
        c = text[i];
        let next = text[i + 1];
        if (c === '"') {
            if (q && next === '"') {
                row[row.length - 1] += '"';
                i++;
            } else {
                q = !q;
            }
        } else if (c === ',' && !q) {
            row.push('');
        } else if ((c === '\r' || c === '\n') && !q) {
            if (c === '\r' && next === '\n') { i++; }
            r.push(row);
            row = [''];
        } else {
            row[row.length - 1] += c;
        }
    }
    if (row.length > 1 || row[0] !== '') {
        r.push(row);
    }
    return r;
}

// ─── Type Parsers ─────────────────────────────────────────────────────────────
const parsePgArray = (str) => {
    if (!str || str === '{}' || str === 'NULL') return [];
    const cleaned = str.replace(/^\{|\}$/g, '');
    if (!cleaned) return [];
    return cleaned.split(',').map(item => {
        let val = item.trim();
        if (val.startsWith('"') && val.endsWith('"')) {
            val = val.substring(1, val.length - 1);
        }
        return val.replace(/""/g, '"');
    });
};

const parseJson = (str, fallback) => {
    if (!str || str === 'NULL' || str === 'null') return fallback;
    try {
        return JSON.parse(str);
    } catch (err) {
        return fallback;
    }
};

const parseBoolean = (str, defaultVal) => {
    if (!str || str === 'NULL') return defaultVal;
    const lower = str.toLowerCase().trim();
    if (lower === 'true' || lower === 't' || lower === '1') return true;
    if (lower === 'false' || lower === 'f' || lower === '0') return false;
    return defaultVal;
};

const parseDate = (str) => {
    if (!str || str === 'NULL' || str.trim() === '') return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
};

const importProducts = async () => {
    try {
        console.log(`[Import] Reading CSV file from: ${CSV_PATH}...`);
        if (!fs.existsSync(CSV_PATH)) {
            throw new Error(`CSV file not found at path: ${CSV_PATH}`);
        }

        const csvData = fs.readFileSync(CSV_PATH, 'utf-8');
        const parsed = parseCSV(csvData);

        if (parsed.length < 2) {
            throw new Error('CSV file is empty or missing data rows.');
        }

        const headers = parsed[0].map(h => h.trim());
        console.log('[Import] CSV Headers:', headers);

        // Connect to the DB
        await connectDB();

        console.log('[Import] Processing rows...');
        let successCount = 0;
        let failCount = 0;

        for (let i = 1; i < parsed.length; i++) {
            const row = parsed[i];
            if (row.length < headers.length) {
                continue;
            }

            const item = {};
            headers.forEach((header, idx) => {
                item[header] = row[idx];
            });

            try {
                // 1. Ensure MainCategory exists
                if (item.mainCategoryId && item.mainCategoryId !== 'NULL') {
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
                if (item.subCategoryId && item.subCategoryId !== 'NULL') {
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
                if (item.companyCategoryId && item.companyCategoryId !== 'NULL') {
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

                const productRecord = {
                    id: item.id,
                    thumbnail: item.thumbnail,
                    images: parsePgArray(item.images),
                    name: parseJson(item.name, { en: '', gu: '', hn: '' }),
                    mainCategoryId: item.mainCategoryId,
                    subCategoryId: item.subCategoryId,
                    companyCategoryId: item.companyCategoryId,
                    isTobaccoProduct: parseBoolean(item.isTobaccoProduct, true),
                    productDescription: parseJson(item.productDescription, {
                        keyInformation: [],
                        nutritionalInformation: [],
                        info: [],
                    }),
                    status: item.status || 'Active',
                    position: parseInt(item.position, 10) || 0,
                    isCombo: parseBoolean(item.isCombo, false),
                    comboProduct1Id: item.comboProduct1Id === 'NULL' || !item.comboProduct1Id ? null : item.comboProduct1Id,
                    comboProduct2Id: item.comboProduct2Id === 'NULL' || !item.comboProduct2Id ? null : item.comboProduct2Id,
                    keywords: parsePgArray(item.keywords),
                    boxNumber: item.boxNumber === 'NULL' || !item.boxNumber ? null : item.boxNumber,
                    createdAt: parseDate(item.createdAt) || new Date(),
                    updatedAt: parseDate(item.updatedAt) || new Date(),
                    deletedAt: parseDate(item.deletedAt)
                };

                // Upsert into DB
                await Product.upsert(productRecord);
                successCount++;

                if (successCount % 50 === 0) {
                    console.log(`[Import] Progress: Imported ${successCount} products...`);
                }
            } catch (err) {
                console.error(`[Import Error] Failed at row ${i + 1} (${item.name || 'Unknown'}):`, err.message);
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
