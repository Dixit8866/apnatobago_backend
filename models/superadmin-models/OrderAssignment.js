import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

const OrderAssignment = sequelize.define('OrderAssignment', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    orderId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    deliveryBoyId: {
        type: DataTypes.UUID,
        allowNull: false,
    },
    status: {
        type: DataTypes.ENUM('Pending', 'Assigned', 'Cancelled', 'Completed'),
        defaultValue: 'Assigned',
    },
    assignedAt: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true,
    }
}, {
    timestamps: true,
    tableName: 'order_assignments',
    paranoid: true,
});

export default OrderAssignment;
