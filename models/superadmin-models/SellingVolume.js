import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const SellingVolume = sequelize.define('SellingVolume', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.JSONB,
        allowNull: false,
        comment: 'Multilingual volume names e.g. { en: "100ml", hn: "...", guj: "..." }'
    },
    status: {
        type: DataTypes.STRING,
        defaultValue: 'Active'
    }
}, {
    timestamps: true,
    tableName: 'selling_volumes',
    paranoid: true, // Soft delete
});

export default SellingVolume;
