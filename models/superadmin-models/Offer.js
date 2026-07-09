import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Offer = sequelize.define('Offer', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    startDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    endDate: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    description: {
        type: DataTypes.JSONB,
        allowNull: true,
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
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    },
    position: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
    }
}, {
    timestamps: true,
    tableName: 'offers',
    paranoid: true, // Enables soft delete
});

export default Offer;
