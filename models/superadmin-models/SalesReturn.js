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
        condition: {
            type: DataTypes.STRING, // 'GOOD' (Restocked) | 'DAMAGED' (Loss/Scrap)
            defaultValue: 'GOOD',
        },
        creditProcessed: {
            type: DataTypes.BOOLEAN,
            defaultValue: true,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Approved',
        },
        companyReturnStatus: {
            type: DataTypes.STRING, // 'PENDING' | 'RETURNED'
            allowNull: true,
            defaultValue: 'PENDING',
        },
        companyReturnedAt: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        companyReturnNote: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        timestamps: true,
        tableName: 'sales_returns',
        paranoid: true, // Soft delete
    }
);

export default SalesReturn;
