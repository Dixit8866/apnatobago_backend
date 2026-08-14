import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OutletOrderItem = sequelize.define(
    'OutletOrderItem',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        outletOrderId: {
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
        },
        variantInfo: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        sellUnit: {
            type: DataTypes.STRING,
            defaultValue: 'Base',
            validate: {
                isIn: [['Base', 'Inner']]
            }
        },
        discount: {
            type: DataTypes.DECIMAL(10, 2),
            defaultValue: 0,
        },
        subtotal: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
        },
    },
    {
        timestamps: true,
        tableName: 'outlet_order_items',
    }
);

export default OutletOrderItem;
