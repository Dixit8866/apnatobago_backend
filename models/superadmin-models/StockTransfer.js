import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const StockTransfer = sequelize.define('StockTransfer', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    transferNo: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    fromGodownId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    toGodownId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('Pending', 'Shipped', 'Received', 'Cancelled'),
        defaultValue: 'Pending',
        allowNull: false,
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    totalAmount: {
        type: DataTypes.DECIMAL(12, 2),
        allowNull: false,
        defaultValue: 0,
    },
    createdBy: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: 'Admin',
    }
}, {
    timestamps: true,
    tableName: 'stock_transfers',
    paranoid: true,
});

export default StockTransfer;
