import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OrderItem = sequelize.define(
    'OrderItem',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        orderId: {
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
        quantity: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 1,
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            comment: 'Price at the time of purchase',
        },
        variantInfo: {
            type: DataTypes.JSONB,
            allowNull: true,
            comment: 'Snapshot of variant details like volume, label etc.',
        },
    },
    {
        timestamps: true,
        tableName: 'order_items',
    }
);

export default OrderItem;
