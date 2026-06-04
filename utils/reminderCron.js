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
            const kolkataTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
            const hours = kolkataTime.getHours();
            const minutes = kolkataTime.getMinutes();
            
            const mm = minutes.toString().padStart(2, '0');
            const hh24 = hours.toString().padStart(2, '0');
            
            const hours12 = hours % 12 || 12;
            const hh12_pad = hours12.toString().padStart(2, '0');
            const hh12_no_pad = hours12.toString();
            const ampm = hours >= 12 ? 'PM' : 'AM';
            
            const timeFormats = [
                `${hh24}:${mm}`,                           // "16:12"
                `${hh12_pad}:${mm} ${ampm}`,               // "04:12 PM"
                `${hh12_no_pad}:${mm} ${ampm}`,             // "4:12 PM"
                `${hh12_pad}:${mm} ${ampm.toLowerCase()}`,     // "04:12 pm"
                `${hh12_no_pad}:${mm} ${ampm.toLowerCase()}`    // "4:12 pm"
            ];

            console.log(`[ReminderCron] Running minute-check... Formats to search: ${JSON.stringify(timeFormats)} (IST)`);

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
                    where: { 
                        reminderTime: {
                            [Op.in]: timeFormats
                        }
                    },
                    attributes: ['fullname', 'number', 'status', 'orderReminder', 'reminderTime', 'fcmtoken'],
                    raw: true
                });
                if (timeMatchedUsers.length > 0) {
                    console.log(`[ReminderCron Debug] Found ${timeMatchedUsers.length} user(s) matching reminderTime formats, details:`);
                    timeMatchedUsers.forEach(u => {
                        console.log(`  -> Name: "${u.fullname}" | Phone: "${u.number}" | Status: "${u.status}" | orderReminder: ${u.orderReminder} | reminderTime: "${u.reminderTime}" | HasToken: ${u.fcmtoken ? 'YES' : 'NO'}`);
                    });
                } else {
                    console.log(`[ReminderCron Debug] No users found matching reminderTime formats`);
                }
            } catch (err) {
                console.error(`[ReminderCron Debug Error] Time match query failed:`, err.message);
            }

            // Find users with reminders enabled for this specific time (matching any format)
            const usersToRemind = await User.findAll({
                where: {
                    orderReminder: true,
                    reminderTime: {
                        [Op.in]: timeFormats
                    },
                    status: 'Active',
                    fcmtoken: { [Op.ne]: null } // Only if they have a notification token
                }
            });

            console.log(`[ReminderCron] Query completed. Found ${usersToRemind.length} user(s) matching reminderTime formats`);

            if (usersToRemind.length > 0) {
                logger.info(`[ReminderCron]: Sending reminders to ${usersToRemind.length} users at ${timeFormats[1]} / ${timeFormats[0]}`);
                
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
