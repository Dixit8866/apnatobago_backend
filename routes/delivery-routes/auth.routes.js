import express from 'express';
import { loginDeliveryBoy, getDeliveryProfile, updateDeliveryProfile } from '../../controllers/delivery/auth.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/login', loginDeliveryBoy);
router.get('/profile', protectDeliveryBoy, getDeliveryProfile);
router.put('/profile', protectDeliveryBoy, updateDeliveryProfile);

export default router;
