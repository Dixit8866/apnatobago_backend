import express from 'express';
import { getDeliveryDashboardStats } from '../../controllers/delivery/dashboard.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply protection middleware to ensure only authenticated delivery boys can access
router.use(protectDeliveryBoy);

// GET /api/delivery/dashboard - Fetch today's summary metrics and rider info
router.get('/', getDeliveryDashboardStats);

export default router;
