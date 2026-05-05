import db from './config/db.js';

async function check() {
    try {
        const assignmentId = 'bf141282-7d85-4357-b59e-20bd0e4edf6f';
        const [res] = await db.query(`SELECT * FROM order_assignments WHERE id = '${assignmentId}'`);
        console.log("Assignment:", res[0]);
        
        if (res[0]) {
            const dbId = res[0].deliveryBoyId;
            const [boy] = await db.query(`SELECT id FROM delivery_boys WHERE id = '${dbId}'`);
            console.log("Is Delivery Boy ID valid in delivery_boys table?", !!boy[0]);
            
            const [user] = await db.query(`SELECT id FROM users WHERE id = '${dbId}'`);
            console.log("Is Delivery Boy ID valid in users table?", !!user[0]);
        }
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
