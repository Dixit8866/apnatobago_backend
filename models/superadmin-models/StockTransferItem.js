import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const StockTransferItem = sequelize.define('StockTransferItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    stockTransferId: {
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
    qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
    },
    amount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    }
}, {
    timestamps: true,
    tableName: 'stock_transfer_items',
    paranoid: true,
});

export default StockTransferItem;
