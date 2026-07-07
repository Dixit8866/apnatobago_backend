import express from 'express';
import authRoutes from './auth.routes.js';
import uploadRoutes from './upload.routes.js';
import staffRoutes from './staff.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import partyRoutes from './party.routes.js';
import partyCallingRoutes from './partyCalling.routes.js';
import salesRoutes from './sales.routes.js';
import paymentRoutes from './payment.routes.js';
import inventoryRoutes from './inventory.routes.js';
import deliveryRoutes from './delivery.routes.js';
import helpSupportRoutes from './helpSupport.routes.js';
import transferRoutes from './transfers.routes.js';

const router = express.Router();

// Auth
router.use('/auth', authRoutes);

// File Upload
router.use('/upload', uploadRoutes);

// Staff Management
router.use('/staff', staffRoutes);

// Dashboard
router.use('/dashboard', dashboardRoutes);

// Party (Assigned parties for this godown)
router.use('/parties', partyRoutes);

// Party Calling
router.use('/party-calling', partyCallingRoutes);

// Sales / Orders
router.use('/sales', salesRoutes);

// Payments
router.use('/payments', paymentRoutes);

// Inventory
router.use('/inventory', inventoryRoutes);

// Transfers (Stock transfers)
router.use('/transfers', transferRoutes);

// Delivery
router.use('/delivery', deliveryRoutes);

// Help & Support
router.use('/help-support', helpSupportRoutes);

export default router;
