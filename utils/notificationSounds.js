import crypto from 'crypto';

// Notification types whose MP3 tune is uploaded by admin in Notification Settings
export const NOTIFICATION_SOUND_TYPES = [
    { type: 'daily_order', name: 'Daily Order', enabled: 'dailyOrderEnabled', sound: 'dailyOrderSound' },
    { type: 'no_order', name: 'No Order', enabled: 'noOrderEnabled', sound: 'noOrderSound' },
    { type: 'rekyc', name: 'ReKYC', enabled: 'rekycEnabled', sound: 'rekycSound' },
    { type: 'kyc', name: 'KYC', enabled: 'kycEnabled', sound: 'kycSound' },
    { type: 'payment_verification', name: 'Payment Verification', enabled: 'paymentVerificationEnabled', sound: 'paymentVerificationSound' }
];

/**
 * Sound id = Android notification channel id the app creates with this tune.
 * A channel's sound can't be changed after creation, so the id carries a short hash of the
 * URL and changes whenever admin uploads a new file. No tune -> plain `${type}_channel`.
 */
export const getSoundId = (type, soundUrl) => soundUrl
    ? `${type}_${crypto.createHash('md5').update(soundUrl).digest('hex').slice(0, 8)}`
    : `${type}_channel`;

/**
 * List served to the app: [{ id, type, name, url, active }]
 */
export const buildNotificationSoundList = (setting) => NOTIFICATION_SOUND_TYPES.map(t => {
    const url = setting?.[t.sound] || '';
    return {
        id: getSoundId(t.type, url),
        type: t.type,
        name: t.name,
        url,
        active: !!url && setting?.[t.enabled] !== false
    };
});
