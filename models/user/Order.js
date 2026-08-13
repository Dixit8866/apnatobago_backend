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
                isIn: [['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']]
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
        paymentCollectStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Unverified',
            validate: {
                isIn: [['Unverified', 'Verified', 'N/A']]
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
                isIn: [['Round', 'Express', 'Outlet']]
            }
        },
        deliveryCharge: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
        deliveryRoundId: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        deliveryRoundTiming: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        orderDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        deliveryDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        deliveredAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        packagingAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        packedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        shippingAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        routeCategoryId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        discount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
        couponPoints: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
        },
        couponDiscount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
        discountType: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        isMerged: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        godownId: {
            type: DataTypes.UUID,
            allowNull: true,
            references: {
                model: 'godowns',
                key: 'id',
            },
            onUpdate: 'CASCADE',
            onDelete: 'SET NULL',
        },
        createdByAdminId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
    },
    {
        timestamps: true,
        tableName: 'orders',
        paranoid: true,
    }
);

export default Order;
