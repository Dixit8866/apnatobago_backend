import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const PartyLedger = sequelize.define('PartyLedger', {
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
    voucherNo: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    voucherType: {
        type: DataTypes.STRING, // 'SALES_INVOICE' | 'PAYMENT' | 'SALES_RETURN' | 'COUPON' | 'OPENING_BALANCE' | 'ADJUSTMENT'
        allowNull: false,
        defaultValue: 'SALES_INVOICE'
    },
    date: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    particulars: {
        type: DataTypes.STRING(500),
        allowNull: false,
    },
    debit: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    credit: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    runningBalance: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0.00
    },
    paymentMethod: {
        type: DataTypes.STRING, // 'CASH' | 'ONLINE' | 'CHEQUE' | 'CREDIT' | 'SALES_RETURN' | 'COUPON' | 'NONE'
        allowNull: true
    },
    bankName: {
        type: DataTypes.STRING,
        allowNull: true
    },
    referenceId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    createdById: {
        type: DataTypes.UUID,
        allowNull: true
    },
    createdByName: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true,
    tableName: 'party_ledgers',
    indexes: [
        {
            fields: ['userId']
        },
        {
            fields: ['orderId']
        },
        {
            fields: ['date']
        },
        {
            fields: ['voucherNo']
        }
    ]
});

export default PartyLedger;
