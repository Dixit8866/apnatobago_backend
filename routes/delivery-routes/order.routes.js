import express from 'express';
import multer from 'multer';
import { 
    getMyAssignedOrders, 
    updateMyAssignmentStatus, 
    reorderAssignments, 
    completeOrderAndSettlePayment, 
    getAssignmentDetails, 
    getUserCreditDetails,
    getUserPreviousBills,
    settleSingleOrderPayment,
    submitDeliveryBankPayment,
    scanAndAssignOrder,
    resolveDeliveryNotice,
    declineDeliveryNotice
} from '../../controllers/delivery/order.controller.js';
import { 
    getDeliveryAreaCategories, 
    getOrdersByAreaCategories 
} from '../../controllers/delivery/areaCategory.controller.js';
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
router.get('/user-previous-bills/:userId', getUserPreviousBills);
router.put('/reorder', reorderAssignments);
router.put('/settle-single', settleSingleOrderPayment);

// Delivery Notice Resolve & Decline APIs (For Delivery App popup modal)
router.put('/notice/resolve', resolveDeliveryNotice);
router.put('/notice/decline', declineDeliveryNotice);
router.put('/:orderId/resolve-notice', resolveDeliveryNotice);
router.put('/:orderId/decline-notice', declineDeliveryNotice);

router.put('/:assignmentId/status', updateMyAssignmentStatus);
router.put('/:assignmentId/complete-settle', completeOrderAndSettlePayment);
router.post('/sales-return', createSalesReturn);
router.post('/scan-assign', scanAndAssignOrder);

// Area categories & Multi-area order listing for Delivery App
router.get('/area-categories', getDeliveryAreaCategories);
router.post('/by-areas', getOrdersByAreaCategories);
router.get('/by-areas', getOrdersByAreaCategories);

// Direct Bank Transfer Payment (for Delivery Boy App)
router.post('/:id/bank-payment', bankPaymentUpload, submitDeliveryBankPayment);

export default router;
