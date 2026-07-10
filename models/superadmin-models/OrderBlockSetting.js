import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OrderBlockSetting = sequelize.define('OrderBlockSetting', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    fromDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    toDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Under Maintenance',
    },
    isBlocked: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    message: {
        type: DataTypes.STRING,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'order_block_settings',
});

export default OrderBlockSetting;
