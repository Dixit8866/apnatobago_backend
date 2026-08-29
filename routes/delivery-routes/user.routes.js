import express from 'express';
import { updateUserLocation } from '../../controllers/common/userLocation.controller.js';
import { adjustPartyBalance, getPartyBalanceLogs } from '../../controllers/admin/user.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Ensure only authenticated delivery boys can update user coordinates / balance
router.use(protectDeliveryBoy);

// PUT /api/delivery/users/:id/location - Update user's latitude and longitude
router.put('/:id/location', updateUserLocation);

// POST /api/delivery/users/:id/balance-adjustment - Adjust party balance (Jama / Baki)
router.post('/:id/balance-adjustment', adjustPartyBalance);

// GET /api/delivery/users/:id/balance-logs - Get party balance transaction logs
router.get('/:id/balance-logs', getPartyBalanceLogs);

export default router;
