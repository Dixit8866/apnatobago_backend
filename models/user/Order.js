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
            allowNull: true,
        },
        saleType: {
            type: DataTypes.STRING,
            defaultValue: 'Online',
            validate: {
                isIn: [['Online', 'Direct']]
            }
        },
        customerName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        customerNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        totalAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        orderStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Pending',
            validate: {
                isIn: [['Pending', 'Packed', 'Shipped', 'Delivered', 'Cancelled']]
            }
        },
        paymentMethod: {
            type: DataTypes.STRING, // COD, ONLINE, CREDIT.
            allowNull: false,
        },
        paymentStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Pending',
            validate: {
                isIn: [['Pending', 'Paid', 'Partial', 'Failed', 'Refunded']]
            }
        },
        paidAmount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
        dueAmount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
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
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isIn: [['Round', 'Express']]
            }
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
