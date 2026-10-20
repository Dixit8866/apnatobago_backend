import cron from 'node-cron';
import { Op } from 'sequelize';
import { User, Order, NotificationSetting } from '../models/index.js';
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

const toMinuteOfDay = (timeStr) => {
    const parsed = parseReminderTime(timeStr);
    return parsed ? parsed.hours * 60 + parsed.minutes : null;
};

/**
 * True when the party's bill print slot is running right now and the
 * minutes elapsed since slot start fall on the configured interval.
 * e.g. slot 04:00 PM, interval 5 -> 4:00, 4:05, ... 4:55 (12 times)
 */
const isDueNow = (billPrintTime, minuteOfDay, intervalMinutes) => {
    const slotStart = toMinuteOfDay(billPrintTime);
    if (slotStart === null) return false;

    const elapsed = minuteOfDay - slotStart;
    if (elapsed < 0 || elapsed >= BILL_SLOT_DURATION_MINUTES) return false;
    return elapsed % intervalMinutes === 0;
};

/**
 * Send one notification to many parties; failures are logged per party
 */
const sendToParties = async (logTag, users, title, body, data) => {
    logger.info(`[${logTag}]: Sending notification to ${users.length} parties`);

    await Promise.all(users.map(async (user) => {
        try {
            const result = await sendToDevice(user.fcmtoken, title, body, null, data);
            if (!result.success) {
                logger.error(`[${logTag}] Failed for ${user.fullname} (${user.number}): ${result.error || 'all tokens failed'}`);
            }
        } catch (err) {
            logger.error(`[${logTag}] Error for ${user.fullname} (${user.number}): ${err.message}`);
        }
    }));
};

/**
 * 1) Daily / Start Order Notification
 * Sent to KYC verified parties in the Daily Order / Start Order list (has
 * ordered before) that have not ordered today, repeatedly during their bill
 * print slot at the interval set in Notification Settings.
 */
export const runDailyOrderNotification = async (setting, { dateStr, minuteOfDay }) => {
    if (!setting.dailyOrderEnabled) return;

    const intervalMinutes = parseInt(setting.dailyOrderMinutes, 10);
    if (!intervalMinutes || intervalMinutes < 1) return;

    const candidates = await User.findAll({
        where: {
            status: 'Active',
            kycverification: 'verified',
            fcmtoken: { [Op.ne]: null },
            billPrintTime: { [Op.ne]: null }
        },
        attributes: ['id', 'fullname', 'number', 'fcmtoken', 'billPrintTime']
    });

    const dueUsers = candidates.filter(u => isDueNow(u.billPrintTime, minuteOfDay, intervalMinutes));
    if (dueUsers.length === 0) return;

    const userIds = dueUsers.map(u => u.id);
    const todayStart = new Date(`${dateStr}T00:00:00+05:30`);
    const todayEnd = new Date(`${dateStr}T23:59:59.999+05:30`);

    const [ordersToday, everOrdered] = await Promise.all([
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
        })
    ]);

    const orderedTodayIds = new Set(ordersToday.map(o => o.userId));
    const everOrderedIds = new Set(everOrdered.map(o => o.userId));

    const usersToNotify = dueUsers.filter(u => everOrderedIds.has(u.id) && !orderedTodayIds.has(u.id));
    if (usersToNotify.length === 0) return;

    await sendToParties('DailyOrderCron', usersToNotify, setting.dailyOrderTitle, setting.dailyOrderMessage, {
        type: 'daily_order',
        soundUrl: setting.dailyOrderSound || ''
    });
};

/**
 * 2) No Order Notification
 * Sent to every party in the Non-Order list (KYC verified, never ordered)
 * at the 3 scheduled timings set in Notification Settings.
 */
export const runNoOrderNotification = async (setting, { minuteOfDay }) => {
    if (!setting.noOrderEnabled) return;

    const scheduledMinutes = [setting.noOrderTime1, setting.noOrderTime2, setting.noOrderTime3].map(toMinuteOfDay);
    if (!scheduledMinutes.includes(minuteOfDay)) return;

    const usersToNotify = await User.findAll({
        where: {
            status: 'Active',
            kycverification: 'verified',
            fcmtoken: { [Op.ne]: null },
            [Op.and]: [
                User.sequelize.literal(`NOT EXISTS (
                    SELECT 1 FROM orders o
                    WHERE o."userId" = "User".id
                      AND o."orderStatus" NOT IN (${CANCELLED_ORDER_STATUSES.map(s => `'${s}'`).join(', ')})
                      AND o."deletedAt" IS NULL
                )`)
            ]
        },
        attributes: ['id', 'fullname', 'number', 'fcmtoken']
    });
    if (usersToNotify.length === 0) return;

    await sendToParties('NoOrderCron', usersToNotify, setting.noOrderTitle, setting.noOrderMessage, {
        type: 'no_order',
        soundUrl: setting.noOrderSound || ''
    });
};

const ORDER_NOTIFICATION_JOBS = [
    ['DailyOrderCron', runDailyOrderNotification],
    ['NoOrderCron', runNoOrderNotification]
];

export const initOrderNotificationCron = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const setting = await NotificationSetting.findOne();
            if (!setting) return;

            const now = getKolkataNow();
            for (const [logTag, job] of ORDER_NOTIFICATION_JOBS) {
                try {
                    await job(setting, now);
                } catch (error) {
                    logger.error(`[${logTag} Error]: ${error.message}`);
                }
            }
        } catch (error) {
            logger.error(`[OrderNotificationCron Error]: ${error.message}`);
        }
    });

    logger.info('[Cron]: Order Notification Jobs (Daily Order, No Order) Initialized ✓');
};
