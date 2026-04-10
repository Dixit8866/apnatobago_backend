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
        volumeId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
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
        image: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        baseUnitLabel: {
            // pcs / gram / ml (for internal counting)
            type: DataTypes.STRING,
            allowNull: false,
            defaultValue: 'pcs',
        },
        baseUnitsPerPack: {
            // how many base units in this volume (e.g., 1 box => 20 pcs, 1 kg => 1000 gram)
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 1,
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
