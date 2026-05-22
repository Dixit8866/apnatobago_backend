import express from 'express';
import { 
    initializeRazorpayOrder, 
    verifyRazorpayPayment, 
    getCollectedPayments, 
    getSubmittedPayments 
} from '../../controllers/delivery/payment.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply protection middleware to all payment routes
router.use(protectDeliveryBoy);

router.post('/razorpay/initialize', initializeRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);

// GET /api/delivery/payments/collected - Get detailed breakdown of collected payments today
router.get('/collected', getCollectedPayments);

// GET /api/delivery/payments/submitted - Get detailed breakdown of submitted payments today
router.get('/submitted', getSubmittedPayments);

export default router;
