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
    mainCategoryId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Associated main category'
    },
    subCategoryId: {
        type: DataTypes.UUID,
        allowNull: true,
        comment: 'Associated sub category'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    },
    isTobacco: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    position: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        allowNull: false,
    }
}, {
    timestamps: true,
    tableName: 'company_categories',
    paranoid: true, // Soft delete
});

export default CompanyCategory;
