import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OTP = sequelize.define('OTP', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    number: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    otp: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false,
    }
}, {
    timestamps: true,
    tableName: 'otps',
});

export default OTP;
