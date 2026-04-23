import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import Vendor from './Vendor.js';
import Godown from './Godown.js';
import Admin from './Admin.js';

const PurchaseBill = sequelize.define('PurchaseBill', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    billNo: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    vendorOrderId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    vendorId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Vendor, key: 'id' },
    },
    receivedDate: {
        type: DataTypes.DATE,
        allowNull: false,
    },
    receivedBy: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Admin, key: 'id' },
    },
    godownId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Godown, key: 'id' },
    },
    // Items: [{ productId, variantId, qty, purchasePrice, total }]
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    totalAmount: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
}, {
    timestamps: true,
    tableName: 'purchase_bills',
    paranoid: true,
});

export default PurchaseBill;
