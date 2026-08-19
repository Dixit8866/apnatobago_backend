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
        hasCoupon: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
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
        isCombo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        comboProduct1Id: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        comboProduct2Id: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        keywords: {
            type: DataTypes.ARRAY(DataTypes.STRING),
            allowNull: false,
            defaultValue: [],
        },
        boxNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        serialNumber: {
            type: DataTypes.STRING,
            allowNull: true,
            defaultValue: null,
        },
        mainVolumeId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        mainVolumeQty: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 1,
        },
        customSalesVolumeId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        customSalesVolumeQty: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: 1,
        },
        customSalesVolumes: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
        internalNote: {
            type: DataTypes.TEXT,
            allowNull: true,
            defaultValue: null,
        },
        couponPoints: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: null,
        },
        couponPrice: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
        },
        lowStockVolumeId: {
            type: DataTypes.UUID,
            allowNull: true,
            defaultValue: null,
        },
        lowStockQuantity: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            defaultValue: null,
        },
        lowStockVolumes: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
    },
    {
        timestamps: true,
        tableName: 'products',
        paranoid: true,
    }
);

export default Product;
