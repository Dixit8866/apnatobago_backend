import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const AdminRole = sequelize.define('AdminRole', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active', // Active | Inactive
    },
}, {
    timestamps: true,
    tableName: 'admin_roles',
});

export default AdminRole;
