import { Op, Sequelize } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        dialect: 'postgres',
        port: parseInt(process.env.DB_PORT) || 5432,
        logging: console.log, // Enable SQL logging to console
    }
);

const Order = sequelize.define('Order', {}, { tableName: 'orders', timestamps: true });

async function run() {
    try {
        console.log('Connecting to database...');
        await sequelize.authenticate();
        console.log('Connected.');

        const startDate = '2026-06-01';
        const endDate = '2026-06-20';

        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);

        // DELIVERED ORDERS
        console.log('\n--- DELIVERED ORDERS QUERY ---');
        const statusList = ['Delivered', 'Payment Collect', 'Payment Verify'];
        const where = { orderStatus: { [Op.in]: statusList } };
        where[Op.or] = [
            { deliveredAt: { [Op.between]: [start, end] } },
            { deliveredAt: null, updatedAt: { [Op.between]: [start, end] } }
        ];

        await Order.findAll({
            where,
            attributes: ['id'],
            limit: 5
        });

        // PARTY REPORT
        console.log('\n--- PARTY REPORT QUERY ---');
        const partyWhere = {};
        partyWhere.createdAt = { [Op.between]: [start, end] };
        await Order.findAll({
            where: partyWhere,
            attributes: ['id'],
            limit: 5
        });

    } catch (err) {
        console.error('Error running script:', err);
    } finally {
        await sequelize.close();
    }
}

run();
