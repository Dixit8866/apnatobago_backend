import express from 'express';
import { 
    getMyAssignedOrders, 
    updateMyAssignmentStatus, 
    reorderAssignments, 
    completeOrderAndSettlePayment, 
    getAssignmentDetails, 
    getUserCreditDetails,
    settleSingleOrderPayment 
} from '../../controllers/delivery/order.controller.js';
import { createSalesReturn } from '../../controllers/common/salesReturn.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

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

export default router;
