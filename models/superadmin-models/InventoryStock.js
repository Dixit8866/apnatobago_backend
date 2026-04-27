import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const InventoryStock = sequelize.define(
    'InventoryStock',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
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
        totalBaseUnits: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        avgPurchasePricePerBaseUnit: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        lastPurchasePricePerBaseUnit: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        expiryDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        batchNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
    },
    {
        timestamps: true,
        tableName: 'inventory_stocks',
        paranoid: true,
        indexes: [
            // Non-unique indexes to allow multiple stock batches per godown-product-variant
            { fields: ['godownId', 'productId', 'variantId'], unique: false },
            { fields: ['productId'], unique: false },
            { fields: ['variantId'], unique: false },
            { fields: ['expiryDate'], unique: false },
            { fields: ['batchNumber'], unique: false },
        ],
    }
);

export default InventoryStock;
