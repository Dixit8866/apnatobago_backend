import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

// One physical stock count (cut-off). While DRAFT, counts are entered;
// POST archives the old stock and creates one OPENING lot per product + godown.
const StockCutoff = sequelize.define(
    'StockCutoff',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        status: {
            // DRAFT | POSTED | CANCELLED
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'DRAFT',
        },
        title: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
        cutoffAt: {
            // set when posted: ledger entries after this time belong to the new books
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        postedAt: {
            type: DataTypes.DATE,
            allowNull: true,
            defaultValue: null,
        },
        postedBy: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        summary: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: null,
        },
    },
    {
        timestamps: true,
        tableName: 'stock_cutoffs',
    }
);

export default StockCutoff;
