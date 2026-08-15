import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OutletOrder = sequelize.define(
    'OutletOrder',
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
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        customerName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        customerPhone: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shopName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        godownId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        orderStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Completed',
        },
        fulfillmentStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Fulfilled',
        },
        paymentStatus: {
            type: DataTypes.STRING,
            defaultValue: 'Pending',
        },
        totalAmount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        discountAmount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        taxAmount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        grandTotal: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        paidAmount: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
        paymentMode: {
            type: DataTypes.STRING,
            defaultValue: 'Cash',
        },
        payments: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: [],
        },
        deliveryDate: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        fulfillmentMode: {
            type: DataTypes.STRING,
            defaultValue: 'ROUND',
        },
        note: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        createdBy: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        isDirectSale: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
    },
    {
        timestamps: true,
        tableName: 'outlet_orders',
        paranoid: true,
    }
);

export default OutletOrder;
