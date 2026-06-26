import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const PartyCalling = sequelize.define('PartyCalling', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'users',
            key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
    },
    callingDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
    },
    status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'Pending Call', // 'Pending Call' | 'Re-Followup' | 'order Coming' | 'Note Order' | 'Order Complete'
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    calledAt: {
        type: DataTypes.DATE,
        allowNull: true,
    },
    followupDateTime: {
        type: DataTypes.DATE,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'party_callings',
    indexes: [
        {
            unique: true,
            fields: ['userId', 'callingDate']
        }
    ]
});

export default PartyCalling;
