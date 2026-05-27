import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const SalesReturn = sequelize.define(
    'SalesReturn',
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
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        deliveryBoyId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        productId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        variantId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        volumeId: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        quantity: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        returnAmount: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        reason: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Approved',
        },
    },
    {
        timestamps: true,
        tableName: 'sales_returns',
        paranoid: true, // Soft delete
    }
);

export default SalesReturn;
