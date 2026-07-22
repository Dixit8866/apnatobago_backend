import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import User from '../models/user/User.js';
import Godown from '../models/superadmin-models/Godown.js';

const TARGET_GODOWN_ID = 'a453cdca-2ccf-41b6-8d8a-8fa8741778c8';

async function assignGodownToAllParties() {
    try {
        console.log('----------------------------------------------------');
        console.log('[Script] Starting Assign Godown update process...');
        console.log('[Script] Authenticating database connection...');
        await sequelize.authenticate();
        console.log('[Script] Connected to database successfully.');

        // 1. Verify if Godown exists
        const godown = await Godown.findByPk(TARGET_GODOWN_ID);
        if (godown) {
            console.log(`[Script] Target Godown Found: "${godown.name}" (${godown.id})`);
        } else {
            console.warn(`[Script Warning] Target Godown ID "${TARGET_GODOWN_ID}" was not found in 'godowns' table!`);
            console.warn(`[Script Warning] Proceeding with UPDATE anyway as requested.`);
        }

        // 2. Count total users
        const totalUsers = await User.count();
        console.log(`[Script] Total parties/users in database: ${totalUsers}`);

        if (totalUsers === 0) {
            console.log('[Script] No users found in database. Exiting.');
            return;
        }

        // 3. Perform SAFE UPDATE (ONLY UPDATE - NO DELETE / REMOVE)
        const [updatedCount] = await User.update(
            { godownId: TARGET_GODOWN_ID },
            { 
                where: {}, // Empty where clause updates ALL rows safely
                silent: true // Prevents unnecessary updatedAt hooks if desired, or standard update
            }
        );

        console.log('----------------------------------------------------');
        console.log(`[Script SUCCESS] ${updatedCount} / ${totalUsers} parties updated successfully!`);
        console.log(`[Script SUCCESS] Assigned Godown ID: "${TARGET_GODOWN_ID}"`);
        console.log('----------------------------------------------------');

    } catch (error) {
        console.error('[Script ERROR] Failed to assign godown to parties:', error);
    } finally {
        await sequelize.close();
        console.log('[Script] Database connection closed.');
    }
}

assignGodownToAllParties();
