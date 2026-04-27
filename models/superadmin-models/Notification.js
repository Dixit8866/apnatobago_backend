import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Notification = sequelize.define('Notification', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    title: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    body: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    imageUrl: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    type: {
        type: DataTypes.ENUM('TOPIC', 'INDIVIDUAL', 'ORDER'),
        allowNull: false,
        defaultValue: 'TOPIC',
    },
    target: {
        type: DataTypes.STRING, // topic name or user ID
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('SENT', 'FAILED'),
        defaultValue: 'SENT',
    },
    sentBy: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    clickAction: {
        type: DataTypes.STRING,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'notifications',
    paranoid: true,
});

export default Notification;
