import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import VendorOrder from './VendorOrder.js';
import Product from './Product.js';
import ProductVariant from './ProductVariant.js';

const VendorOrderItem = sequelize.define('VendorOrderItem', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    vendorOrderId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: VendorOrder, key: 'id' },
        onDelete: 'CASCADE',
    },
    productId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: Product, key: 'id' },
    },
    variantId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: ProductVariant, key: 'id' },
    },
    qty: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
    },
    price: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00,
    },
}, {
    timestamps: true,
});

export default VendorOrderItem;
