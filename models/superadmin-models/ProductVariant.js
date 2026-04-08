import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const ProductVariant = sequelize.define(
    'ProductVariant',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        productId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        volume: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        purchasePrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: false,
            defaultValue: 0,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
    },
    {
        timestamps: true,
        tableName: 'product_variants',
        paranoid: true,
    }
);

export default ProductVariant;
