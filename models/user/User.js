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
        allowNull: true,
    },
    showtabacco: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    creditline: {
        type: DataTypes.DECIMAL(10, 2),
        defaultValue: 0,
    },
    blockcredit: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    applevel: {
        type: DataTypes.UUID,
        allowNull: true,
        defaultValue: '6b0722c6-ee28-4058-b4de-a961d1b16da0',
    },
    routeCategoryId: {
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
        defaultValue: true,
    },
    reminderTime: {
        type: DataTypes.STRING, // Store as "hh:mm a" like "09:00 PM"
        defaultValue: '09:00 PM',
        allowNull: true,
    },
    latitude: {
        type: DataTypes.DECIMAL(15, 10),
        allowNull: true,
    },
    longitude: {
        type: DataTypes.DECIMAL(15, 10),
        allowNull: true,
    },
    deliveryRoundId: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    deliveryRoundTiming: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    deviceType: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    version: {
        type: DataTypes.STRING,
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
