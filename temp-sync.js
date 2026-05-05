import OrderPayment from './models/user/OrderPayment.js';
import './models/index.js'; // to load associations

async function syncTable() {
    try {
        await OrderPayment.sync({ force: true });
        console.log("order_payments table synced.");
    } catch(e) {
        console.error(e);
    } finally {
        process.exit();
    }
}
syncTable();
