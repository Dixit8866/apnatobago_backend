import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const PartyBalanceLog = sequelize.define('PartyBalanceLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING, // 'JAMA' | 'BAKI' | 'ADJUSTMENT' | 'PAYMENT'
        allowNull: false,
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
    },
    previousBalance: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    newBalance: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    createdByName: {
        type: DataTypes.STRING,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'party_balance_logs'
});

export default PartyBalanceLog;
