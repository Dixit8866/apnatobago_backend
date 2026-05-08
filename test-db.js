import sequelize from './config/db.js';
import User from './models/user/User.js';

async function test() {
    try {
        await sequelize.authenticate();
        console.log('Database connected successfully.');

        const users = await User.findAll({
            limit: 5,
            order: [['createdAt', 'DESC']]
        });

        console.log('--- Last 5 Users ---');
        users.forEach(user => {
            console.log({
                id: user.id,
                fullname: user.fullname,
                number: user.number,
                status: user.status,
                logintoken: user.logintoken ? `${user.logintoken.slice(0, 15)}...` : null
            });
        });

        process.exit(0);
    } catch (err) {
        console.error('Error querying database:', err.message);
        process.exit(1);
    }
}

test();
