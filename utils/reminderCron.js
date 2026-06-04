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
                timeZone: 'Asia/Kolkata',
                hour12: true, 
                hour: '2-digit', 
                minute: '2-digit' 
            }); // Returns "hh:mm AM/PM" in IST (India Standard Time) (e.g., "09:00 PM")

            console.log(`[ReminderCron] Running minute-check... Current Time: ${currentTime} (IST)`);

            // Debug: Check specific test user 9106681629
            try {
                const testUser = await User.findOne({
                    where: { number: { [Op.like]: '%9106681629%' } },
                    attributes: ['fullname', 'number', 'status', 'orderReminder', 'reminderTime', 'fcmtoken'],
                    raw: true
                });
                if (testUser) {
                    console.log(`[ReminderCron Debug] Test User 9106681629 Info: Name: "${testUser.fullname}" | Status: "${testUser.status}" | orderReminder: ${testUser.orderReminder} | reminderTime: "${testUser.reminderTime}" | HasToken: ${testUser.fcmtoken ? 'YES' : 'NO'}`);
                } else {
                    console.log(`[ReminderCron Debug] Test User 9106681629 not found in DB!`);
                }
            } catch (err) {
                console.error(`[ReminderCron Debug Error] Test user query failed:`, err.message);
            }

            // Debug: Check if any users have the matching reminderTime regardless of status, token, or toggle
            try {
                const timeMatchedUsers = await User.findAll({
                    where: { reminderTime: currentTime },
                    attributes: ['fullname', 'number', 'status', 'orderReminder', 'reminderTime', 'fcmtoken'],
                    raw: true
                });
                if (timeMatchedUsers.length > 0) {
                    console.log(`[ReminderCron Debug] Found ${timeMatchedUsers.length} user(s) matching reminderTime: '${currentTime}', details:`);
                    timeMatchedUsers.forEach(u => {
                        console.log(`  -> Name: "${u.fullname}" | Phone: "${u.number}" | Status: "${u.status}" | orderReminder: ${u.orderReminder} | HasToken: ${u.fcmtoken ? 'YES' : 'NO'}`);
                    });
                } else {
                    console.log(`[ReminderCron Debug] No users found with reminderTime: '${currentTime}'`);
                }
            } catch (err) {
                console.error(`[ReminderCron Debug Error] Time match query failed:`, err.message);
            }

            // Find users with reminders enabled for this specific time
            const usersToRemind = await User.findAll({
                where: {
                    orderReminder: true,
                    reminderTime: currentTime,
                    status: 'Active',
                    fcmtoken: { [Op.ne]: null } // Only if they have a notification token
                }
            });

            console.log(`[ReminderCron] Query completed. Found ${usersToRemind.length} user(s) matching reminderTime: '${currentTime}'`);

            if (usersToRemind.length > 0) {
                logger.info(`[ReminderCron]: Sending reminders to ${usersToRemind.length} users at ${currentTime}`);
                
                for (const user of usersToRemind) {
                    // Logic to send FCM notification
                    sendOrderReminderNotification(user);
                }
            }
        } catch (error) {
            console.error(`[ReminderCron Error] Job execution failed:`, error.message);
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
        console.log(`[ReminderCron] Initiating push notification for User: ${user.fullname} (Phone: ${user.number})`);
        logger.info(`[Push Notification]: Initiating order reminder to ${user.fullname} (${user.number})`);
        
        const title = 'Order Reminder';
        const body = `Hey ${user.fullname}, it's time to place your daily order with Apna Tobacco!`;
        
        // Call sendToDevice with type: 'reminder' (default)
        const result = await sendToDevice(user.fcmtoken, title, body, null, { type: 'reminder' });
        
        if (result.success) {
            console.log(`[ReminderCron Success] Notification successfully sent to ${user.fullname}`);
            logger.info(`[Push Notification Success]: Sent order reminder to ${user.fullname}`);
        } else {
            console.error(`[ReminderCron Error] Notification failed for ${user.fullname}:`, result.error);
            logger.error(`[Push Notification Failed] for ${user.fullname}: ${result.error}`);
        }
    } catch (err) {
        console.error(`[ReminderCron Exception] for ${user.fullname}:`, err.message);
        logger.error(`[Notification Error] for ${user.fullname}: ${err.message}`);
    }
};
