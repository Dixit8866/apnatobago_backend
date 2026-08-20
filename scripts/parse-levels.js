import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sequelize from '../config/db.js';
import CustomLevel from '../models/superadmin-models/CustomLevel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, 'custom_levels.json');

async function main() {
    try {
        await sequelize.authenticate();

        if (!fs.existsSync(jsonPath)) {
            console.error(`JSON file not found at ${jsonPath}`);
            process.exit(1);
        }

        const levelsData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

        // Seed / bulk upsert custom levels
        const fieldsToUpdate = Object.keys(CustomLevel.rawAttributes).filter(
            f => f !== 'createdAt'
        );

        await CustomLevel.bulkCreate(levelsData, {
            updateOnDuplicate: fieldsToUpdate,
            paranoid: false
        });

        console.log('[Script] Custom levels successfully seeded/updated in database.');
    } catch (error) {
        console.error('[Script] Error seeding custom levels:', error);
    } finally {
        await sequelize.close();
        console.log('[Script] Database connection closed.');
    }
}

main();
