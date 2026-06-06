import sequelize from '../config/db.js';
import { OrderAssignment, Order } from '../models/index.js';
import { Op } from 'sequelize';
import { getTodayRangeIST } from '../controllers/delivery/dashboard.controller.js';

const runTest = async (statusVal) => {
    const deliveryBoyId = '00000000-0000-0000-0000-000000000000'; // dummy uuid
    const status = statusVal;

    const whereClause = { deliveryBoyId };
    const orderIncludeWhere = {};

    let normalizedStatus = status;
    if (status) {
        normalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
    }

    if (normalizedStatus) {
        if (normalizedStatus === 'Cancelled') {
            const { todayStart, todayEnd } = getTodayRangeIST();
            whereClause[Op.and] = [
                {
                    [Op.or]: [
                        { status: 'Cancelled' },
                        { '$order.orderStatus$': 'Cancelled' }
                    ]
                },
                {
                    [Op.or]: [
                        { updatedAt: { [Op.between]: [todayStart, todayEnd] } },
                        { '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] } }
                    ]
                }
            ];
        } else if (normalizedStatus === 'Completed') {
            const { todayStart, todayEnd } = getTodayRangeIST();
            whereClause.status = 'Completed';
            whereClause.updatedAt = { [Op.between]: [todayStart, todayEnd] };
        } else if (normalizedStatus === 'Assigned' || normalizedStatus === 'Pending') {
            whereClause.status = normalizedStatus;
            orderIncludeWhere.orderStatus = { [Op.ne]: 'Cancelled' };
        } else {
            whereClause.status = normalizedStatus;
        }
    } else {
        const { todayStart, todayEnd } = getTodayRangeIST();
        whereClause[Op.or] = [
            {
                status: { [Op.in]: ['Pending', 'Assigned'] }
            },
            {
                status: 'Completed',
                updatedAt: { [Op.between]: [todayStart, todayEnd] }
            },
            {
                [Op.and]: [
                    {
                        [Op.or]: [
                            { status: 'Cancelled' },
                            { '$order.orderStatus$': 'Cancelled' }
                        ]
                    },
                    {
                        [Op.or]: [
                            { updatedAt: { [Op.between]: [todayStart, todayEnd] } },
                            { '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] } }
                        ]
                    }
                ]
            }
        ];
    }

    console.log(`--- Testing SQL for status: "${status}" ---`);
    try {
        // We compile the query options to see the SQL. 
        // We use findAndCountAll but turn on logging to console.log.
        await OrderAssignment.findAndCountAll({
            where: whereClause,
            include: [
                {
                    model: Order,
                    as: 'order',
                    where: Object.keys(orderIncludeWhere).length > 0 ? orderIncludeWhere : null
                }
            ],
            limit: 10,
            offset: 0,
            order: [['position', 'ASC'], ['order', 'createdAt', 'ASC']],
            subQuery: false,
            logging: (sql) => {
                console.log(sql);
            }
        });
    } catch (err) {
        // Ignore DB connection errors, we just want to see the SQL output before it fails (or if it fails after SQL generation)
        if (err.message && !err.message.includes('Connection')) {
            console.error("Sequelize Error:", err.message);
        }
    }
};

const main = async () => {
    await runTest('Completed');
    await runTest('Cancelled');
    await runTest(undefined);
    process.exit(0);
};

main();
