import express from 'express';
import { initializeRazorpayOrder, verifyRazorpayPayment } from '../../controllers/delivery/payment.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply protection middleware to all payment routes
router.use(protectDeliveryBoy);

router.post('/razorpay/initialize', initializeRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);

export default router;
