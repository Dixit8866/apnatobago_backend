import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const AppNoticeSetting = sequelize.define('AppNoticeSetting', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    isActive: {
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
    imageUrl: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    buttonText: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'ઓકે (OK)',
    },
    buttonLink: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    fromDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    toDate: {
        type: DataTypes.DATE,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'app_notice_settings',
});

export default AppNoticeSetting;
