import dotenv from 'dotenv';
dotenv.config();

console.log('Loading inventory controller...');
import * as inventoryController from './controllers/admin/inventory.controller.js';
console.log('Inventory controller loaded successfully.');

console.log('ALL INVENTORY SYNTAX & IMPORTS VERIFIED SUCCESSFULLY! ✓');
process.exit(0);
