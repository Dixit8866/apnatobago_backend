import admin from 'firebase-admin';
import { credential } from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../logger/apiLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
        // Clean up the private key (remove literal \n strings, extra quotes, and trim)
        const privateKey = process.env.FIREBASE_PRIVATE_KEY
            ?.replace(/\\n/g, '\n')      // Replace literal \n with real newline
            .replace(/"/g, '')           // Remove any extra double quotes
            .replace(/'/g, '')           // Remove any extra single quotes
            .trim();

        serviceAccount = {
            project_id: process.env.FIREBASE_PROJECT_ID,
            private_key: privateKey,
            client_email: process.env.FIREBASE_CLIENT_EMAIL,
        };
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: credential.cert(serviceAccount)
        });
        logger.info('Firebase Admin initialized successfully');
    } else {
        logger.warn('Firebase Admin: No credentials provided');
    }
} catch (error) {
    logger.error(`Firebase Admin initialization failed: ${error.message}`);
}

/**
 * Send notification to a specific FCM token
 */
export const sendToDevice = async (token, title, body, imageUrl = null, data = {}) => {
    try {
        const message = {
            token,
            notification: {
                title,
                body,
                ...(imageUrl && { imageUrl })
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
                notification: {
                    ...(imageUrl && { imageUrl }),
                    priority: 'high',
                    sound: 'default'
                }
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true,
                        sound: 'default'
                    }
                },
                fcm_options: {
                    ...(imageUrl && { imageUrl })
                }
            }
        };

        const response = await admin.messaging().send(message);
        return { success: true, response };
    } catch (error) {
        logger.error(`Error sending device notification: ${error.message}`);
        return { success: false, error: error.message };
    }
};

/**
 * Send notification to a topic
 */
export const sendToTopic = async (topic, title, body, imageUrl = null, data = {}) => {
    try {
        const message = {
            topic,
            notification: {
                title,
                body,
                ...(imageUrl && { imageUrl })
            },
            data: {
                ...data,
                click_action: 'FLUTTER_NOTIFICATION_CLICK',
            },
            android: {
                notification: {
                    ...(imageUrl && { imageUrl }),
                    priority: 'high',
                    sound: 'default'
                }
            },
            apns: {
                payload: {
                    aps: {
                        contentAvailable: true,
                        sound: 'default'
                    }
                },
                fcm_options: {
                    ...(imageUrl && { imageUrl })
                }
            }
        };

        const response = await admin.messaging().send(message);
        return { success: true, response };
    } catch (error) {
        logger.error(`Error sending topic notification: ${error.message}`);
        return { success: false, error: error.message };
    }
};

export default admin;
