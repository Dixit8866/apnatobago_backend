import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const BusinessProfile = sequelize.define(
    'BusinessProfile',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        userId: {
            type: DataTypes.UUID,
            allowNull: false,
            unique: true, // One user can have only one business profile
        },
        bannerImage: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        profileImage: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shopName: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        gstNumber: {
            type: DataTypes.STRING,
            allowNull: true,
        },
        shopAddress: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        city: {
            type: DataTypes.STRING,
            allowNull: false,
        },
        postcode: {
            type: DataTypes.STRING,
            allowNull: false,
        },
    },
    {
        timestamps: true,
        tableName: 'business_profiles',
        paranoid: true,
    }
);

export default BusinessProfile;
