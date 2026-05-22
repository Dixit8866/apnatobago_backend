import dotenv from 'dotenv';
dotenv.config();

console.log('Loading dashboard controller...');
import * as dashboardController from './controllers/delivery/dashboard.controller.js';
console.log('Dashboard controller loaded successfully.');

console.log('ALL DASHBOARD SYNTAX & IMPORTS VERIFIED SUCCESSFULLY! ✓');
process.exit(0);
