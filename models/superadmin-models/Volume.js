import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Volume = sequelize.define('Volume', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'Multilingual volume names e.g. { en: "100ml", hn: "...", guj: "..." }'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    },
    icon: {
        type: DataTypes.STRING,
        allowNull: true,
        comment: 'Volume icon image URL'
    }
}, {
    timestamps: true,
    tableName: 'volumes',
    paranoid: true, // Soft delete
});

export default Volume;
