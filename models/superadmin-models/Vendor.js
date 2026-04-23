import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const Vendor = sequelize.define(
    'Vendor',
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
        vendorId: {
            type: DataTypes.STRING,
            allowNull: true,
            unique: true,
        },
        companyName: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        email: {
            type: DataTypes.STRING,
            allowNull: true,
            validate: {
                isEmail: true,
            },
        },
        whatsappNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        phoneNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        address: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        gstNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING,
            defaultValue: 'Active', // Active, Inactive, Deleted
        },
    },
    {
        timestamps: true,
        tableName: 'vendors',
        paranoid: true, // Adds deletedAt column for soft deletes
    }
);

export default Vendor;
