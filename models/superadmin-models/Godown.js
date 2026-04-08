import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Godown = sequelize.define('Godown', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    type: {
        type: DataTypes.STRING,
        defaultValue: 'main', // main | sub
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    pincodes: {
        type: DataTypes.JSONB,
        defaultValue: [],
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active', // Active | Inactive
    },
}, {
    timestamps: true,
    tableName: 'godowns'
});

export default Godown;
