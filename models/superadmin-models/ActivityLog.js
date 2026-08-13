import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const ActivityLog = sequelize.define(
    'ActivityLog',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        userType: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'Admin', // 'Admin', 'GodownStaff', 'DeliveryBoy', 'System', 'User'
        },
        userName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        userRole: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        module: {
            type: DataTypes.STRING,
            allowNull: false, // 'Order List', 'Custom Sales', 'Products', 'Purchase Bill', 'Order Received Bill', 'Stock Inventory', 'Users', 'Vendors', 'Settings'
        },
        action: {
            type: DataTypes.STRING,
            allowNull: false, // 'CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'PAYMENT', 'STOCK_UPDATE'
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        metadata: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        ipAddress: {
            type: DataTypes.STRING,
            allowNull: true,
        },
    },
    {
        timestamps: true,
        tableName: 'activity_logs',
        indexes: [
            { fields: ['module'] },
            { fields: ['action'] },
            { fields: ['userId'] },
            { fields: ['createdAt'] },
        ],
    }
);

export default ActivityLog;
