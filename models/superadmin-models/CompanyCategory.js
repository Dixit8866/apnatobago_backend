import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const CompanyCategory = sequelize.define('CompanyCategory', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    image: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    title: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'Multilingual titles e.g. { en: "...", hn: "...", guj: "..." }'
    },
    description: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Multilingual descriptions'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    }
}, {
    timestamps: true,
    tableName: 'company_categories',
    paranoid: true, // Soft delete
});

export default CompanyCategory;
