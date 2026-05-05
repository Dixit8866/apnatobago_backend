import db from './config/db.js';

async function check() {
    try {
        const [res] = await db.query("SELECT id FROM delivery_boys LIMIT 5;");
        console.log("Delivery Boys:", res);
        
        const [res2] = await db.query("SELECT id, role FROM users LIMIT 5;");
        console.log("Users:", res2);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
