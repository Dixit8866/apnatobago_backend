import cron from 'node-cron';
import { User } from '../models/index.js';
import logger from '../logger/apiLogger.js';
import { Op } from 'sequelize';
import { sendToDevice } from '../services/notification.service.js';

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
        logger.info(`[Push Notification]: Initiating order reminder to ${user.fullname} (${user.number})`);
        
        const title = 'Order Reminder';
        const body = `Hey ${user.fullname}, it's time to place your daily order with Apna Tobacco!`;
        
        // Call sendToDevice with type: 'reminder' (default)
        const result = await sendToDevice(user.fcmtoken, title, body, null, { type: 'reminder' });
        
        if (result.success) {
            logger.info(`[Push Notification Success]: Sent order reminder to ${user.fullname}`);
        } else {
            logger.error(`[Push Notification Failed] for ${user.fullname}: ${result.error}`);
        }
    } catch (err) {
        logger.error(`[Notification Error] for ${user.fullname}: ${err.message}`);
    }
};
