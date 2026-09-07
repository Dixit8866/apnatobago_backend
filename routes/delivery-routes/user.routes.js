import express from 'express';
import { updateUserLocation } from '../../controllers/common/userLocation.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Ensure only authenticated delivery boys can update user coordinates
router.use(protectDeliveryBoy);

// PUT /api/delivery/users/:id/location - Update user's latitude and longitude
router.put('/:id/location', updateUserLocation);

export default router;
