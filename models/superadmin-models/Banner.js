import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Banner = sequelize.define('Banner', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    title: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    mainCategoryId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    subCategoryId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    productId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Category'
    }
}, {
    timestamps: true,
    tableName: 'banners',
    paranoid: true, // Enables soft delete
});

export default Banner;
