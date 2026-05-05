import db from './config/db.js';

async function check() {
    try {
        const [res] = await db.query("SELECT * FROM information_schema.columns WHERE table_name = 'order_payments';");
        console.log(res.map(c => c.column_name));
        
        const [fks] = await db.query("SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'order_payments';");
        console.log(fks);
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
check();
