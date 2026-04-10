import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Product = sequelize.define(
    'Product',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        thumbnail: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        images: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: false,
            defaultValue: [],
        },
        name: {
            type: DataTypes.JSONB,
            allowNull: false,
        },
        mainCategoryId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        subCategoryId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        companyCategoryId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        productDescription: {
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: {
                keyInformation: [],
                nutritionalInformation: [],
                info: [],
            },
        },
        packagings: {
            // [{ baseUnitLabel: 'box', baseUnitsPerPack: 10 }]
            type: DataTypes.JSONB,
            allowNull: true,
            defaultValue: [],
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
    },
    {
        timestamps: true,
        tableName: 'products',
        paranoid: true,
    }
);

export default Product;
