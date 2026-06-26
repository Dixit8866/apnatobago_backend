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
router.post('/:id/bank-payment', submitBankPayment);

export default router;
