import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const NotificationSetting = sequelize.define('NotificationSetting', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    // 1) Daily / Start Order Notification
    dailyOrderEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    dailyOrderSound: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    dailyOrderMinutes: {
        type: DataTypes.INTEGER,
        defaultValue: 10,
    },
    dailyOrderTitle: {
        type: DataTypes.STRING,
        defaultValue: 'Start Taking Orders / દૈનિક ઓર્ડર',
    },
    dailyOrderMessage: {
        type: DataTypes.TEXT,
        defaultValue: 'આજનો ઓર્ડર લેવાનું શરૂ કરો.',
    },

    // 2) No Order Notification (3 times)
    noOrderEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    noOrderSound: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    noOrderTime1: {
        type: DataTypes.STRING,
        defaultValue: '08:00 AM',
    },
    noOrderTime2: {
        type: DataTypes.STRING,
        defaultValue: '12:00 PM',
    },
    noOrderTime3: {
        type: DataTypes.STRING,
        defaultValue: '07:00 PM',
    },
    noOrderTitle: {
        type: DataTypes.STRING,
        defaultValue: 'No Order Reminder / ઓર્ડર નથી આવ્યો',
    },
    noOrderMessage: {
        type: DataTypes.TEXT,
        defaultValue: 'તમારો આજનો ઓર્ડર બાકી છે, કૃપા કરીને ઓર્ડર બુક કરો.',
    },

    // 3) ReKYC Notification (3 times)
    rekycEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    rekycSound: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    rekycTime1: {
        type: DataTypes.STRING,
        defaultValue: '08:00 AM',
    },
    rekycTime2: {
        type: DataTypes.STRING,
        defaultValue: '12:00 PM',
    },
    rekycTime3: {
        type: DataTypes.STRING,
        defaultValue: '07:00 PM',
    },
    rekycTitle: {
        type: DataTypes.STRING,
        defaultValue: 'ReKYC Reminder / પુનઃ કેવાયસી',
    },
    rekycMessage: {
        type: DataTypes.TEXT,
        defaultValue: 'તમારું KYC અપડેટ બાકી છે. કૃપા કરીને વેરિફિકેશન પૂર્ણ કરો.',
    },

    // 4) KYC Notification (3 times)
    kycEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    kycSound: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    kycTime1: {
        type: DataTypes.STRING,
        defaultValue: '08:00 AM',
    },
    kycTime2: {
        type: DataTypes.STRING,
        defaultValue: '12:00 PM',
    },
    kycTime3: {
        type: DataTypes.STRING,
        defaultValue: '07:00 PM',
    },
    kycTitle: {
        type: DataTypes.STRING,
        defaultValue: 'KYC Verification / કેવાયસી વેરિફિકેશન',
    },
    kycMessage: {
        type: DataTypes.TEXT,
        defaultValue: 'તમારું KYC વેરિફિકેશન પૂર્ણ કરો.',
    },

    // 5) Payment Verification Notification (mp3 only)
    paymentVerificationEnabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
    paymentVerificationSound: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    paymentVerificationTitle: {
        type: DataTypes.STRING,
        defaultValue: 'Payment Verification / પેમેન્ટ વેરિફિકેશન',
    },
    paymentVerificationMessage: {
        type: DataTypes.TEXT,
        defaultValue: 'તમારું પેમેન્ટ સફળતાપૂર્વક વેરિફાઇ થઈ ગયું છે.',
    },
}, {
    timestamps: true,
    tableName: 'notification_settings',
});

export default NotificationSetting;
