import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const DailyReconciliation = sequelize.define(
    'DailyReconciliation',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        date: {
            type: DataTypes.DATEONLY,
            allowNull: false,
        },
        godownId: {
            type: DataTypes.UUID,
            allowNull: true,
            comment: 'Null for all godowns summary, or specific godown UUID',
        },
        openingStockAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        salesStockAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        purchaseStockAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        closingStockAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        openingCashBalance: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        cashSalesAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        onlineSalesAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        purchasePaymentAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        expensesAmount: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        closingCashBalance: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        netProfit: {
            type: DataTypes.DECIMAL(14, 2),
            defaultValue: 0,
        },
        quantitySummary: {
            type: DataTypes.JSONB,
            allowNull: true,
            comment: 'Array of item/carton quantity details: opening, sold, purchased, closing',
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Draft',
            validate: {
                isIn: [['Draft', 'Settled']]
            }
        },
        settledByAdminId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        timestamps: true,
        tableName: 'daily_reconciliations',
        paranoid: true,
        indexes: [
            {
                unique: true,
                fields: ['date', 'godownId'],
                name: 'unique_date_godown_reconciliation'
            }
        ]
    }
);

export default DailyReconciliation;
