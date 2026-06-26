import express from 'express';
import multer from 'multer';
import { 
    createOrder, 
    getOrders, 
    getOrderDetails, 
    getOrderDetailsV2,
    cancelOrder,
    updateOrder,
    getOrdersWithPaymentStatus,
    initializeRazorpayOrder,
    verifyRazorpayPayment,
    submitBankPayment
} from '../../controllers/user/order.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// Memory storage to process files via SDK buffer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage, 
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const bankPaymentUpload = upload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'screenshot', maxCount: 1 }
]);

// All routes require authentication
router.use(protectUser);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/payment-status', getOrdersWithPaymentStatus);
router.get('/:id/order-details', getOrderDetailsV2);
router.get('/:id', getOrderDetails);
router.put('/:id', updateOrder);
router.put('/:id/cancel', cancelOrder);

// Razorpay Payments
router.post('/razorpay/initialize', initializeRazorpayOrder);
router.post('/razorpay/verify', verifyRazorpayPayment);

// Direct Bank Transfer Payment
router.post('/:id/bank-payment', bankPaymentUpload, submitBankPayment);

export default router;
