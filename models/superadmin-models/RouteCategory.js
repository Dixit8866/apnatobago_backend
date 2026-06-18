import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const RouteCategory = sequelize.define('RouteCategory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    pincode: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active' // Active | Inactive | Deleted
    }
}, {
    timestamps: true,
    tableName: 'route_categories',
    paranoid: true, // Soft delete
});

export default RouteCategory;
