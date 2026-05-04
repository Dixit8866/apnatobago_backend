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
    position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    },
    isTobacco: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    }
}, {
    timestamps: true,
    tableName: 'main_categories',
    paranoid: true, // Enables soft delete
});

export default MainCategory;
