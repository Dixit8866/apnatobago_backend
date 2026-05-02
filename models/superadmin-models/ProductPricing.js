import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const ProductPricing = sequelize.define(
    'ProductPricing',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        variantId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        customLevelId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        quantityRange: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        minQty: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
        },
        maxQty: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
        },
        purchasePrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        price: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        mrp: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
    },
    {
        timestamps: true,
        tableName: 'product_pricings',
        paranoid: true,
    }
);

export default ProductPricing;
