import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import bcrypt from 'bcryptjs';

/**
 * Admin Model definition
 */
const Admin = sequelize.define('Admin', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: { isEmail: true },
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.STRING,
        defaultValue: 'staff', // superadmin | staff
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    address: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    salary: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true,
    },
    profileImage: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    /**
     * JSONB permissions map — only enforced for non-superadmin staff
     * Example:
     * {
     *   "languages":        { "create": true,  "read": true, "update": false, "delete": false },
     *   "categories_main":  { "create": false, "read": true, "update": false, "delete": false },
     *   "volumes":          { "create": true,  "read": true, "update": true,  "delete": true  }
     * }
     */
    permissions: {
        type: DataTypes.JSONB,
        defaultValue: {},
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active', // Active | Inactive | Deleted
    },
}, {
    timestamps: true,
    tableName: 'admins',
    hooks: {
        beforeCreate: async (admin) => {
            if (admin.password) {
                const salt = await bcrypt.genSalt(10);
                admin.password = await bcrypt.hash(admin.password, salt);
            }
        },
        beforeUpdate: async (admin) => {
            if (admin.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                admin.password = await bcrypt.hash(admin.password, salt);
            }
        }
    }
});

/**
 * Compare password method using bcrypt
 * @param {string} enteredPassword - password provided by admin
 * @returns {boolean}
 */
Admin.prototype.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export default Admin;
