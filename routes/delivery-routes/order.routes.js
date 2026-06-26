import express from 'express';
import multer from 'multer';
import { 
    getMyAssignedOrders, 
    updateMyAssignmentStatus, 
    reorderAssignments, 
    completeOrderAndSettlePayment, 
    getAssignmentDetails, 
    getUserCreditDetails,
    settleSingleOrderPayment,
    submitDeliveryBankPayment
} from '../../controllers/delivery/order.controller.js';
import { createSalesReturn } from '../../controllers/common/salesReturn.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

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

// Apply protection middleware to all order routes
router.use(protectDeliveryBoy);

router.get('/', getMyAssignedOrders);
router.get('/details/:assignmentId', getAssignmentDetails);
router.get('/user-credit/:userId', getUserCreditDetails);
router.put('/reorder', reorderAssignments);
router.put('/settle-single', settleSingleOrderPayment);
router.put('/:assignmentId/status', updateMyAssignmentStatus);
router.put('/:assignmentId/complete-settle', completeOrderAndSettlePayment);
router.post('/sales-return', createSalesReturn);

// Direct Bank Transfer Payment (for Delivery Boy App)
router.post('/:id/bank-payment', bankPaymentUpload, submitDeliveryBankPayment);

export default router;
