import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

// Physical count of one product in one godown for a cut-off session.
const StockOpeningCount = sequelize.define(
    'StockOpeningCount',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        cutoffId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        productId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        godownId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        entries: {
            // counted qty per volume: { [variantId]: qty }
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: {},
        },
        qtyBase: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        unitCost: {
            // cost per base unit
            type: DataTypes.DECIMAL(14, 4),
            allowNull: false,
            defaultValue: 0,
        },
        note: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        updatedBy: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        timestamps: true,
        tableName: 'stock_opening_counts',
        indexes: [{ unique: true, fields: ['cutoffId', 'productId', 'godownId'] }],
    }
);

export default StockOpeningCount;
