import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const PartyLedgerEditLog = sequelize.define('PartyLedgerEditLog', {
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
    billNo: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    field: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    oldValue: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    newValue: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    updatedById: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    updatedByName: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Admin',
    }
}, {
    timestamps: true,
    tableName: 'party_ledger_edit_logs'
});

export default PartyLedgerEditLog;
