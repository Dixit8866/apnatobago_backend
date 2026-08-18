import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const RouteSection = sequelize.define('RouteSection', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    areaCategoryIds: {
        type: DataTypes.JSONB,
        defaultValue: [],
    },
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active' // Active | Inactive | Deleted
    },
    position: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
    }
}, {
    timestamps: true,
    tableName: 'route_sections',
    paranoid: true,
});

export default RouteSection;
