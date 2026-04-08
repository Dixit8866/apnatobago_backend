import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const CustomLevel = sequelize.define(
    'CustomLevel',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active',
        },
    },
    {
        timestamps: true,
        tableName: 'custom_levels',
        paranoid: true,
    }
);

export default CustomLevel;
