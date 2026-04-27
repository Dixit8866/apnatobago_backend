import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const AdminNotification = sequelize.define('AdminNotification', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    message: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING, // ORDER, INVENTORY, USER, etc.
        defaultValue: 'GENERAL',
    },
    referenceId: {
        type: DataTypes.STRING, // e.g. Order ID
        allowNull: true,
    },
    isRead: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    clickAction: {
        type: DataTypes.STRING,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'admin_notifications',
    paranoid: true,
});

export default AdminNotification;
