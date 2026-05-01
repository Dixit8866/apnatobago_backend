import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import bcrypt from 'bcryptjs';

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    fullname: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isEmail: true,
        },
    },
    dialcode: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    number: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    city: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    postcode: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    showtabacco: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    creditline: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    applevel: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    fcmtoken: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    logintoken: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active', // Active | Inactive | Deleted
    },
    kycverification: {
        type: DataTypes.STRING,
        defaultValue: 'pending', // pending | verified
    },
    orderReminder: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    reminderTime: {
        type: DataTypes.STRING, // Store as "HH:mm" like "08:00"
        allowNull: true,
    },
    credit: {
        type: DataTypes.VIRTUAL,
        get() {
            return this.creditline;
        },
        set(value) {
            this.creditline = value;
        }
    }
}, {
    timestamps: true,
    tableName: 'users',
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(user.password, salt);
            }
        },
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(user.password, salt);
            }
        }
    }
});

User.prototype.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export default User;
