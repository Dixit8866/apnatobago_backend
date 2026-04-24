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
    freeDeliveryThreshold: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 10000,
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
    razorpayKeyId: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    razorpaySecretKey: {
        type: DataTypes.STRING,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'app_settings',
});

export default AppSettings;
