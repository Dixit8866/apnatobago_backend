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
            type: DataTypes.ENUM('PURCHASE', 'SALE', 'ADJUSTMENT', 'SALES_RETURN'),
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
        createdBy: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: 'System',
        },
        // ── Stock ledger fields (written by services/stock.service.js) ──
        movement: {
            // OPENING | PURCHASE | MANUAL_IN | SALE | SALE_REVERSAL | SALES_RETURN | DAMAGED_RETURN |
            // TRANSFER_IN | TRANSFER_OUT | ADJUSTMENT_IN | ADJUSTMENT_OUT | CUTOFF_ARCHIVE
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        qtyChange: {
            // signed change of product stock in base units (+ in, − out)
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        unitCost: {
            type: DataTypes.DECIMAL(14, 4),
            allowNull: true,
            defaultValue: null,
        },
        refType: {
            // ORDER | OUTLET_ORDER | PURCHASE_BILL | TRANSFER | OPENING | MANUAL
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        refId: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        refNo: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        reversedQty: {
            // how much of this SALE entry has already come back (cancel / edit / return)
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        sourceEntryId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        reason: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        createdById: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        meta: {
            // extra details, e.g. opening qty typed per volume { entries: { [variantId]: qty }, openingBase }
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        timestamps: true,
        tableName: 'inventory_transactions',
        paranoid: true,
        indexes: [
            { fields: ['productId', 'godownId', 'createdAt'] },
            { fields: ['refType', 'refId'] },
            { fields: ['movement'] },
        ],
    }
);

export default InventoryTransaction;
