import cron from 'node-cron';
import { User } from '../models/index.js';
import logger from '../logger/apiLogger.js';
import { Op } from 'sequelize';
import { sendToDevice } from '../services/notification.service.js';

/**
 * Initialize Order Reminder Cron Jobs
 * Runs every minute to check for users with scheduled reminders
 */
/**
 * Helper to parse reminderTime string ("03:55 PM", "15:52", "3:55 pm", etc.)
 * into { hours, minutes } in 24-hour format.
 */
export const parseReminderTime = (timeStr) => {
    if (!timeStr) return null;
    
    // Normalize string: uppercase, trim, and collapse spaces
    const normalized = timeStr.trim().toUpperCase().replace(/\s+/g, ' ');
    
    // Try 12-hour format (e.g., "03:55 PM", "3:55PM", "03:55PM")
    const match12 = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
    if (match12) {
        let h = parseInt(match12[1], 10);
        const m = parseInt(match12[2], 10);
        const ampm = match12[3];
        
        if (h >= 1 && h <= 12 && m >= 0 && m <= 59) {
            if (ampm === 'PM' && h < 12) {
                h += 12;
            } else if (ampm === 'AM' && h === 12) {
                h = 0;
            }
            return { hours: h, minutes: m };
        }
    }
    
    // Try 24-hour format (e.g., "15:52", "03:52")
    const match24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
    if (match24) {
        const h = parseInt(match24[1], 10);
        const m = parseInt(match24[2], 10);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            return { hours: h, minutes: m };
        }
    }
    
    return null;
};

/**
 * Initialize Order Reminder Cron Jobs
 * Runs every minute to check for users with scheduled reminders
 */
export const initReminderCron = () => {
    // Schedule check every minute
    cron.schedule('* * * * *', async () => {
        try {
            // Get current Kolkata time using Intl.DateTimeFormat (timezone safe)
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Kolkata',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });
            const formattedParts = formatter.formatToParts(new Date());
            const hoursPart = formattedParts.find(p => p.type === 'hour').value;
            const minutesPart = formattedParts.find(p => p.type === 'minute').value;
            
            const hours = parseInt(hoursPart, 10);
            const minutes = parseInt(minutesPart, 10);
            
            const mm = minutes.toString().padStart(2, '0');
            const hh24 = hours.toString().padStart(2, '0');
            const time24 = `${hh24}:${mm}`;

            // Debug: Check specific test user 9106681629
            try {
                const testUser = await User.findOne({
                    where: { number: { [Op.like]: '%9106681629%' } },
                    attributes: ['fullname', 'number', 'status', 'orderReminder', 'reminderTime', 'fcmtoken'],
                    raw: true
                });
                if (testUser) {
                    const parsed = parseReminderTime(testUser.reminderTime);
                    console.log(`[ReminderCron Debug] Test User 9106681629 Info: Name: "${testUser.fullname}" | Status: "${testUser.status}" | orderReminder: ${testUser.orderReminder} | reminderTime: "${testUser.reminderTime}" (Parsed: ${parsed ? `${parsed.hours}:${parsed.minutes}` : 'INVALID'}) | HasToken: ${testUser.fcmtoken ? 'YES' : 'NO'}`);
                } else {
                    console.log(`[ReminderCron Debug] Test User 9106681629 not found in DB!`);
                }
            } catch (err) {
                console.error(`[ReminderCron Debug Error] Test user query failed:`, err.message);
            }

            // Fetch all active users with orderReminder enabled and FCM token
            const activeUsers = await User.findAll({
                where: {
                    orderReminder: true,
                    status: 'Active',
                    fcmtoken: { [Op.ne]: null }
                }
            });

            // Filter users whose reminder time matches current hour & minute
            const usersToRemind = activeUsers.filter(u => {
                const parsed = parseReminderTime(u.reminderTime);
                if (!parsed) return false;
                return parsed.hours === hours && parsed.minutes === minutes;
            });

            console.log(`[ReminderCron] Query/Filter completed. Found ${usersToRemind.length} user(s) matching time ${time24}`);

            if (usersToRemind.length > 0) {
                logger.info(`[ReminderCron]: Sending reminders to ${usersToRemind.length} users at ${time24}`);
                
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
