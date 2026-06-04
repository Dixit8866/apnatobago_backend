import { initializeApp, cert, getApp, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger/apiLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let firebaseApp;

// Initialize Firebase Admin
try {
    let serviceAccount;
    const serviceAccountPath = join(__dirname, '../config/apna-tobacco-firebase-adminsdk-fbsvc-ec6226f705.json');

    // 1. Try loading from Full JSON Environment Variable (Recommended for Production/VPS)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } 
    // 2. Try loading from local JSON file (Easiest for Local Dev)
    else if (existsSync(serviceAccountPath)) {
        serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
        logger.info('Firebase Admin: Loaded from local JSON file');
    }
    // 3. Try loading from individual env variables
    else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && !process.env.FIREBASE_PRIVATE_KEY.includes('...')) {
        const privateKey = process.env.FIREBASE_PRIVATE_KEY
            ?.replace(/\\n/g, '\n')
            .replace(/"/g, '')
            .replace(/'/g, '')
            .trim();

        serviceAccount = {
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key: privateKey,
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
        };
    }

    if (serviceAccount) {
        if (getApps().length === 0) {
            firebaseApp = initializeApp({
                credential: cert(serviceAccount)
            });
            console.log('[Firebase Admin Initialize] Initialized new app successfully');
            logger.info('Firebase Admin initialized successfully');
        } else {
            firebaseApp = getApp();
            console.log('[Firebase Admin Initialize] Reused existing app instance');
        }
    } else {
        console.warn('[Firebase Admin Initialize] Warning: No service account credentials found!');
        logger.warn('Firebase Admin: No credentials provided or placeholder detected');
    }
} catch (error) {
    console.error('[Firebase Admin Initialize Error] Exception:', error);
    logger.error(`Firebase Admin initialization failed: ${error.message}`);
}

/**
 * Send notification to a specific FCM token
 */
export const sendToDevice = async (token, title, body, imageUrl = null, data = {}) => {
    console.log('[FCM Service] Attempting to send device notification...');
    console.log(`[FCM Service] Token: ${token}`);
    console.log(`[FCM Service] Title: "${title}", Body: "${body}", Image: "${imageUrl}"`);
    console.log('[FCM Service] Custom Data:', JSON.stringify(data, null, 2));

    try {
        if (!firebaseApp) {
            console.error('[FCM Service Error] Firebase Admin App not initialized!');
            throw new Error('Firebase Admin not initialized');
        }

        const notificationType = data.type || 'reminder';

        let androidSound = 'otherNotification';
        let androidChannelId = 'other_notification_channel';
        let apnsSound = 'otherNotification.mp3';
        let actionValue = 'FLUTTER_NOTIFICATION_CLICK';

        switch (notificationType) {
            case 'reminder':
                androidSound = 'reminder';
                androidChannelId = 'reminder_channel';
                apnsSound = 'reminder.mp3';
                actionValue = 'categories';
                break;
            case 'shipping':
                androidSound = 'otherNotification';
                androidChannelId = 'shipping_notification_channel';
                apnsSound = 'otherNotification.mp3';
                actionValue = data.action || data.clickAction || data.click_action || 'shipping';
                break;
            case 'other':
            default:
                androidSound = 'otherNotification';
                androidChannelId = 'other_notification_channel';
                apnsSound = 'otherNotification.mp3';
                actionValue = data.action || data.clickAction || data.click_action || 'FLUTTER_NOTIFICATION_CLICK';
                break;
        }

        const message = {
            token,
            notification: {
                title,
                body,
                ...(imageUrl && { image: imageUrl })
            },
            data: {
                type: notificationType,
                ...data,
                action: actionValue,
            },
            android: {
                notification: {
                    ...(imageUrl && { image: imageUrl }),
                    priority: 'high',
                    sound: androidSound,
                    channelId: androidChannelId
                }
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true,
                        sound: apnsSound
                    }
                },
                fcm_options: {
                    ...(imageUrl && { image: imageUrl })
                }
            }
        };

        const response = await getMessaging(firebaseApp).send(message);
        console.log('[FCM Service Success] Device notification sent successfully! MessageID:', response);
        return { success: true, response };
    } catch (error) {
        console.error('[FCM Service Error] Exception during sendToDevice:', error);
        logger.error(`Error sending device notification: ${error.message}`);
        return { success: false, error: error.message };
    }
};

/**
 * Send notification to a topic
 */
export const sendToTopic = async (topic, title, body, imageUrl = null, data = {}) => {
    console.log(`[FCM Service] Attempting to send topic notification to topic: "${topic}"...`);
    console.log(`[FCM Service] Title: "${title}", Body: "${body}", Image: "${imageUrl}"`);
    console.log('[FCM Service] Custom Data:', JSON.stringify(data, null, 2));

    try {
        if (!firebaseApp) {
            console.error('[FCM Service Error] Firebase Admin App not initialized!');
            throw new Error('Firebase Admin not initialized');
        }

        const notificationType = data.type || 'reminder';

        let androidSound = 'otherNotification';
        let androidChannelId = 'other_notification_channel';
        let apnsSound = 'otherNotification.mp3';
        let actionValue = 'home';

        switch (notificationType) {
            case 'reminder':
                androidSound = 'reminder';
                androidChannelId = 'reminder_channel';
                apnsSound = 'reminder.mp3';
                actionValue = 'categories';
                break;
            case 'shipping':
                androidSound = 'otherNotification';
                androidChannelId = 'shipping_notification_channel';
                apnsSound = 'otherNotification.mp3';
                actionValue = data.action || data.clickAction || data.click_action || 'shipping';
                break;
            case 'other':
            default:
                androidSound = 'otherNotification';
                androidChannelId = 'other_notification_channel';
                apnsSound = 'otherNotification.mp3';
                actionValue = data.action || data.clickAction || data.click_action || 'home';
                break;
        }

        const message = {
            topic,
            notification: {
                title,
                body,
                ...(imageUrl && { image: imageUrl })
            },
            data: {
                type: notificationType,
                ...data,
                action: actionValue,
            },
            android: {
                notification: {
                    ...(imageUrl && { image: imageUrl }),
                    priority: 'high',
                    sound: androidSound,
                    channelId: androidChannelId
                }
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true,
                        sound: apnsSound
                    }
                },
                fcm_options: {
                    ...(imageUrl && { image: imageUrl })
                }
            }
        };

        const response = await getMessaging(firebaseApp).send(message);
        console.log('[FCM Service Success] Topic notification sent successfully! MessageID:', response);
        return { success: true, response };
    } catch (error) {
        console.error('[FCM Service Error] Exception during sendToTopic:', error);
        logger.error(`Error sending topic notification: ${error.message}`);
        return { success: false, error: error.message };
    }
};

export default firebaseApp;
