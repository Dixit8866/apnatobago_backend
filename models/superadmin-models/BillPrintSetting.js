import { DataTypes } from 'sequelize';
import sequelize from '../../config/db.js';

// Thermal bill print options (single row)
const BillPrintSetting = sequelize.define('BillPrintSetting', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    // Volumes shown in the bill's unit-wise totals box (કુલ કાર્ટૂન / કુલ બોક્સ ...); empty = all volumes
    summaryVolumeIds: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
    }
}, {
    timestamps: true,
    tableName: 'bill_print_settings',
});

export default BillPrintSetting;
