import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import User from '../models/user/User.js';

async function main() {
  try {
    console.log('[Script] Authenticating database connection...');
    await sequelize.authenticate();
    console.log('[Script] Connected successfully.');

    const targetLevelId = '6b0722c6-ee28-4058-b4de-a961d1b16da0';

    // Count how many users will be updated
    const totalUsers = await User.count();
    const usersToUpdate = await User.count({
      where: {
        applevel: {
          [sequelize.Sequelize.Op.ne]: targetLevelId
        }
      }
    });

    console.log(`[Script] Total users in database: ${totalUsers}`);
    console.log(`[Script] Users needing update: ${usersToUpdate}`);

    if (usersToUpdate === 0) {
      console.log('[Script] All users already have the Premium level.');
      return;
    }

    // Perform the update
    const [updatedCount] = await User.update(
      { applevel: targetLevelId },
      { where: {} }
    );

    console.log(`[Script] Successfully updated ${updatedCount} users to Premium level (${targetLevelId}).`);
  } catch (error) {
    console.error('[Script] Error running update script:', error);
  } finally {
    await sequelize.close();
    console.log('[Script] Database connection closed.');
  }
}

main();
