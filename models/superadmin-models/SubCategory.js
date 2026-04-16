import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import MainCategory from './MainCategory.js';

const SubCategory = sequelize.define('SubCategory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    mainCategoryId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: MainCategory,
            key: 'id'
        }
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    title: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    description: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    }
}, {
    timestamps: true,
    tableName: 'sub_categories',
    paranoid: true, // Soft delete
});

// Associations
MainCategory.hasMany(SubCategory, { foreignKey: 'mainCategoryId', as: 'subCategories' });
SubCategory.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

export default SubCategory;
