import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const InventoryTransaction = sequelize.define(
    'InventoryTransaction',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        stockId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        productId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        variantId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        godownId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        type: {
            type: DataTypes.ENUM('PURCHASE', 'SALE', 'ADJUSTMENT'),
            allowNull: false,
        },
        primaryUnitId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        secondaryUnitId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        secondaryPerPrimary: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
        },
        qtyPrimary: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        qtySecondary: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        totalQtyBaseUnits: {
            type: DataTypes.INTEGER,
            allowNull: false,
        },
        purchasePricePerBaseUnit: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
            defaultValue: null,
        },
        avgPriceAfterTxn: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        balanceAfterBaseUnits: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        timestamps: true,
        tableName: 'inventory_transactions',
        paranoid: true,
    }
);

export default InventoryTransaction;
