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
        isTobaccoProduct: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
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
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
        position: {
            type: DataTypes.INTEGER,
            defaultValue: 0,
            allowNull: false,
        },
    },
    {
        timestamps: true,
        tableName: 'products',
        paranoid: true,
    }
);

export default Product;
