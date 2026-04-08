import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Language = sequelize.define('Language', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    code: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    }
}, {
    timestamps: true,
    tableName: 'languages',
    paranoid: true, // Enables soft delete
});

export default Language;
