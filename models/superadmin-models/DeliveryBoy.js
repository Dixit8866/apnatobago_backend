import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';
import bcrypt from 'bcryptjs';

const DeliveryBoy = sequelize.define('DeliveryBoy', {
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
        allowNull: true,
        unique: true,
        validate: { isEmail: true },
    },
    phone: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    vehicleNumber: {
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
        type: DataTypes.ENUM('Active', 'Inactive'),
        defaultValue: 'Active',
    },
}, {
    timestamps: true,
    tableName: 'delivery_boys',
    paranoid: true,
    hooks: {
        beforeCreate: async (boy) => {
            if (boy.password) {
                const salt = await bcrypt.genSalt(10);
                boy.password = await bcrypt.hash(boy.password, salt);
            }
        },
        beforeUpdate: async (boy) => {
            if (boy.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                boy.password = await bcrypt.hash(boy.password, salt);
            }
        }
    }
});

DeliveryBoy.prototype.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

export default DeliveryBoy;
