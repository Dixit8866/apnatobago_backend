import express from 'express';
import { getMyAssignedOrders, updateMyAssignmentStatus, reorderAssignments, completeOrderAndSettlePayment, getAssignmentDetails } from '../../controllers/delivery/order.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply protection middleware to all order routes
router.use(protectDeliveryBoy);

router.get('/', getMyAssignedOrders);
router.get('/details/:assignmentId', getAssignmentDetails);
router.put('/reorder', reorderAssignments);
router.put('/:assignmentId/status', updateMyAssignmentStatus);
router.put('/:assignmentId/complete-settle', completeOrderAndSettlePayment);

export default router;
