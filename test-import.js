import { updateOrder } from './controllers/user/order.controller.js';
import { getProducts } from './controllers/user/catalogue.controller.js';
import { getWishlist } from './controllers/user/wishlist.controller.js';

console.log('--- Import Verification Test ---');
console.log('updateOrder controller:', typeof updateOrder);
console.log('getProducts controller:', typeof getProducts);
console.log('getWishlist controller:', typeof getWishlist);
console.log('All imports successful!');
process.exit(0);
