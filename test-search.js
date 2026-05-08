import sequelize from './config/db.js';
import CompanyCategory from './models/superadmin-models/CompanyCategory.js';
import { Op } from 'sequelize';

async function run() {
    try {
        const search = 'tam';
        const searchWhere = {
            [Op.or]: [
                sequelize.where(sequelize.cast(sequelize.col('title'), 'text'), { [Op.iLike]: `%${search}%` })
            ]
        };

        const result = await CompanyCategory.findAll({
            where: {
                ...searchWhere,
                status: { [Op.ne]: 'Deleted' }
            },
            logging: console.log
        });

        console.log("Found records:", result.length);
        for (const item of result) {
            console.log(" - Item title:", JSON.stringify(item.title));
        }
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

run();
