import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const HelpSupport = sequelize.define(
    'HelpSupport',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true, // Optional if guest support allowed, but usually tied to user
        },
        customerName: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        shopName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        mobileNumber: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        message: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        status: {
            type: DataTypes.ENUM('Pending', 'Resolved', 'Closed'),
            defaultValue: 'Pending',
        },
    },
    {
        timestamps: true,
        tableName: 'help_supports',
        paranoid: true,
    }
);

export default HelpSupport;
