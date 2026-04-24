import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Order = sequelize.define(
    'Order',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        orderId: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            comment: 'Unique human-readable Order ID like ORD-123456',
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        totalAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        orderStatus: {
            type: DataTypes.ENUM('Pending', 'Packed', 'Shipped', 'Delivered', 'Cancelled'),
            defaultValue: 'Pending',
        },
        paymentMethod: {
            type: DataTypes.STRING, // COD, Razorpay, etc.
            allowNull: false,
        },
        paymentStatus: {
            type: DataTypes.ENUM('Pending', 'Paid', 'Failed', 'Refunded'),
            defaultValue: 'Pending',
        },
        shippingAddress: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        razorpayOrderId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        razorpayPaymentId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        notes: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        deliveryMode: {
            type: DataTypes.ENUM('Round', 'Express'),
            allowNull: true,
        },
        deliveryCharge: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
    },
    {
        timestamps: true,
        tableName: 'orders',
        paranoid: true,
    }
);

export default Order;
