import cron from 'node-cron';
import { User } from '../models/index.js';
import logger from '../logger/apiLogger.js';
import { Op } from 'sequelize';

/**
 * Initialize Order Reminder Cron Jobs
 * Runs every minute to check for users with scheduled reminders
 */
export const initReminderCron = () => {
    // Schedule check every minute
    cron.schedule('* * * * *', async () => {
        try {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('en-US', { 
                hour12: false, 
                hour: '2-digit', 
                minute: '2-digit' 
            }); // Returns "HH:mm"

            // Find users with reminders enabled for this specific time
            const usersToRemind = await User.findAll({
                where: {
                    orderReminder: true,
                    reminderTime: currentTime,
                    status: 'Active',
                    fcmtoken: { [Op.ne]: null } // Only if they have a notification token
                }
            });

            if (usersToRemind.length > 0) {
                logger.info(`[ReminderCron]: Sending reminders to ${usersToRemind.length} users at ${currentTime}`);
                
                for (const user of usersToRemind) {
                    // Logic to send FCM notification
                    sendOrderReminderNotification(user);
                }
            }
        } catch (error) {
            logger.error(`[ReminderCron Error]: ${error.message}`);
        }
    });
    
    logger.info('[Cron]: Order Reminder Job Initialized ✓');
};

/**
 * Send FCM Notification to User
 * @param {Object} user 
 */
const sendOrderReminderNotification = async (user) => {
    try {
        // Here you would normally use firebase-admin to send the push notification
        // For now, we log it. If you have a notification utility, call it here.
        logger.info(`[Push Notification]: Sent order reminder to ${user.fullname} (${user.number})`);
        
        // Example structure for firebase-admin (assuming it's set up)
        /*
        const message = {
            notification: {
                title: 'Order Reminder',
                body: `Hey ${user.fullname}, it's time to place your daily order with Apna Tobacco!`,
            },
            token: user.fcmtoken,
        };
        admin.messaging().send(message);
        */
    } catch (err) {
        logger.error(`[Notification Error] for ${user.fullname}: ${err.message}`);
    }
};
