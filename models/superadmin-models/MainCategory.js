import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const MainCategory = sequelize.define('MainCategory', {
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
    description: {
        type: DataTypes.JSONB,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    }
}, {
    timestamps: true,
    tableName: 'main_categories',
    paranoid: true, // Enables soft delete
});

export default MainCategory;
