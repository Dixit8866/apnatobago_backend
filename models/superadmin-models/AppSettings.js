import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const AppSettings = sequelize.define('AppSettings', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    deliveryOnRoundCharge: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    expressDeliveryCharge: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    showExpressDelivery: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    freeDeliveryThreshold: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 10000,
    },
    supportPhoneNumber: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    androidVersion: {
        type: DataTypes.STRING,
        defaultValue: '1.0.0',
    },
    iosVersion: {
        type: DataTypes.STRING,
        defaultValue: '1.0.0',
    },
    forceUpdate: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    deliveryAndroidVersion: {
        type: DataTypes.STRING,
        defaultValue: '1.0.0',
    },
    deliveryIosVersion: {
        type: DataTypes.STRING,
        defaultValue: '1.0.0',
    },
    deliveryForceUpdate: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    deliveryRoundSchedules: {
        type: DataTypes.JSONB,
        defaultValue: [],
    },
    razorpayKeyId: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    razorpaySecretKey: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    morningDeliveryStart: {
        type: DataTypes.STRING,
        defaultValue: '08:00',
    },
    morningDeliveryEnd: {
        type: DataTypes.STRING,
        defaultValue: '13:00',
    },
    eveningDeliveryStart: {
        type: DataTypes.STRING,
        defaultValue: '15:00',
    },
    eveningDeliveryEnd: {
        type: DataTypes.STRING,
        defaultValue: '17:00',
    }
}, {
    timestamps: true,
    tableName: 'app_settings',
});

export default AppSettings;
