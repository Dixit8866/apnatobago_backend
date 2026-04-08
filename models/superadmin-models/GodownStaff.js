/**
 * GodownStaff Model
 * Completely separate from Admin model.
 * Stores staff members assigned to specific godowns.
 */
import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import bcrypt from 'bcryptjs';

const GodownStaff = sequelize.define('GodownStaff', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    godownId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'godowns',
            key: 'id',
        },
        onDelete: 'CASCADE',
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
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active', // Active | Inactive
    },
}, {
    timestamps: true,
    tableName: 'godown_staffs',
    hooks: {
        beforeCreate: async (staff) => {
            if (staff.password) {
                const salt = await bcrypt.genSalt(10);
                staff.password = await bcrypt.hash(staff.password, salt);
            }
        },
        beforeUpdate: async (staff) => {
            if (staff.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                staff.password = await bcrypt.hash(staff.password, salt);
            }
        }
    }
});

GodownStaff.prototype.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export default GodownStaff;
