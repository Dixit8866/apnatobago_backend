import cron from 'node-cron';
import { Op } from 'sequelize';
import { User, Order, PartyCalling, NotificationSetting } from '../models/index.js';
import logger from '../logger/apiLogger.js';
import { sendToDevice } from '../services/notification.service.js';
import { parseReminderTime } from './reminderCron.js';

const CANCELLED_ORDER_STATUSES = ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];

// Each bill print slot ("04:00 PM") covers one hour: 04:00 PM to 05:00 PM
const BILL_SLOT_DURATION_MINUTES = 60;

/**
 * Current Asia/Kolkata date (YYYY-MM-DD) and minutes since midnight
 */
const getKolkataNow = () => {
    const now = new Date();
    const dateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(now);

    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        hour: 'numeric',
        minute: 'numeric',
        hour12: false
    }).formatToParts(now);
    const hours = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
    const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);

    return { dateStr, minuteOfDay: hours * 60 + minutes };
};

/**
 * True when the party's bill print slot is running right now and the
 * minutes elapsed since slot start fall on the configured interval.
 * e.g. slot 04:00 PM, interval 5 -> 4:00, 4:05, ... 4:55 (12 times)
 */
const isDueNow = (billPrintTime, minuteOfDay, intervalMinutes) => {
    const parsed = parseReminderTime(billPrintTime);
    if (!parsed) return false;

    const elapsed = minuteOfDay - (parsed.hours * 60 + parsed.minutes);
    if (elapsed < 0 || elapsed >= BILL_SLOT_DURATION_MINUTES) return false;
    return elapsed % intervalMinutes === 0;
};

/**
 * Daily / Start Order Notification
 * Sent to KYC verified parties that are in the Party Calling "Pending Call"
 * (Daily / Start Order) list and have not ordered today, repeatedly during
 * their bill print slot at the interval set in Notification Settings.
 */
export const runDailyOrderNotification = async () => {
    const setting = await NotificationSetting.findOne();
    if (!setting || !setting.dailyOrderEnabled) return;

    const intervalMinutes = parseInt(setting.dailyOrderMinutes, 10);
    if (!intervalMinutes || intervalMinutes < 1) return;

    const { dateStr, minuteOfDay } = getKolkataNow();

    const candidates = await User.findAll({
        where: {
            status: 'Active',
            fcmtoken: { [Op.ne]: null },
            billPrintTime: { [Op.ne]: null }
        },
        attributes: ['id', 'fullname', 'number', 'fcmtoken', 'billPrintTime', 'kycverification']
    });

    const dueUsers = candidates.filter(u =>
        String(u.kycverification || '').toLowerCase() === 'verified' &&
        isDueNow(u.billPrintTime, minuteOfDay, intervalMinutes)
    );
    if (dueUsers.length === 0) return;

    const userIds = dueUsers.map(u => u.id);
    const todayStart = new Date(`${dateStr}T00:00:00+05:30`);
    const todayEnd = new Date(`${dateStr}T23:59:59.999+05:30`);

    // Same rules as the Party Calling list (getDailyPartyCalls)
    const [ordersToday, everOrdered, movedCalls] = await Promise.all([
        Order.findAll({
            where: {
                userId: { [Op.in]: userIds },
                orderStatus: { [Op.notIn]: CANCELLED_ORDER_STATUSES },
                [Op.or]: [
                    { createdAt: { [Op.gte]: todayStart, [Op.lte]: todayEnd } },
                    { deliveryDate: dateStr }
                ]
            },
            attributes: ['userId'],
            raw: true
        }),
        Order.findAll({
            where: {
                userId: { [Op.in]: userIds },
                orderStatus: { [Op.notIn]: CANCELLED_ORDER_STATUSES }
            },
            attributes: ['userId'],
            group: ['userId'],
            raw: true
        }),
        // Admin manually moved the party out of Pending Call for today
        PartyCalling.findAll({
            where: {
                userId: { [Op.in]: userIds },
                callingDate: dateStr,
                status: { [Op.in]: ['Refollowup Call', 'Rekyc Call'] }
            },
            attributes: ['userId'],
            raw: true
        })
    ]);

    const orderedTodayIds = new Set(ordersToday.map(o => o.userId));
    const everOrderedIds = new Set(everOrdered.map(o => o.userId));
    const movedIds = new Set(movedCalls.map(c => c.userId));

    const usersToNotify = dueUsers.filter(u =>
        !orderedTodayIds.has(u.id) &&
        everOrderedIds.has(u.id) &&
        !movedIds.has(u.id)
    );
    if (usersToNotify.length === 0) return;

    logger.info(`[DailyOrderCron]: Sending daily order notification to ${usersToNotify.length} parties`);

    const title = setting.dailyOrderTitle;
    const body = setting.dailyOrderMessage;
    const data = {
        type: 'daily_order',
        soundUrl: setting.dailyOrderSound || ''
    };

    await Promise.all(usersToNotify.map(async (user) => {
        try {
            const result = await sendToDevice(user.fcmtoken, title, body, null, data);
            if (!result.success) {
                logger.error(`[DailyOrderCron] Failed for ${user.fullname} (${user.number}): ${result.error || 'all tokens failed'}`);
            }
        } catch (err) {
            logger.error(`[DailyOrderCron] Error for ${user.fullname} (${user.number}): ${err.message}`);
        }
    }));
};

export const initDailyOrderNotificationCron = () => {
    cron.schedule('* * * * *', async () => {
        try {
            await runDailyOrderNotification();
        } catch (error) {
            logger.error(`[DailyOrderCron Error]: ${error.message}`);
        }
    });

    logger.info('[Cron]: Daily / Start Order Notification Job Initialized ✓');
};
