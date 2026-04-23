import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import Vendor from './Vendor.js';

const VendorOrder = sequelize.define('VendorOrder', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    orderNo: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    vendorId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Vendor, key: 'id' },
    },
    status: {
        type: DataTypes.ENUM('Pending', 'Received', 'Cancelled'),
        defaultValue: 'Pending',
    },
    // Items stored as JSONB array: [{ productId, productName, variantId, volume, unitLabel, qty }]
    items: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    },
    totalItems: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    },
    note: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    isConverted: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
}, {
    timestamps: true,
    paranoid: true,
});

export default VendorOrder;
