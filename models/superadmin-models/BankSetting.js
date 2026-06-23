import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const BankSetting = sequelize.define('BankSetting', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    bankName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    accountName: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active' // Active | Inactive | Deleted
    }
}, {
    timestamps: true,
    tableName: 'bank_settings',
    paranoid: true, // Soft delete
});

export default BankSetting;
