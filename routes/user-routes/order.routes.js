import express from 'express';
import { 
    createOrder, 
    getOrders, 
    getOrderDetails, 
    cancelOrder,
    getOrdersWithPaymentStatus,
    initializeRazorpayOrder,
    verifyRazorpayPayment
} from '../../controllers/user/order.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protectUser);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/payment-status', getOrdersWithPaymentStatus);
router.get('/:id', getOrderDetails);
router.put('/:id/cancel', cancelOrder);

// Razorpay Payments
router.post('/razorpay/initialize', initializeRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);

export default router;
