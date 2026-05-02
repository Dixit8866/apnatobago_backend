import express from 'express';
import { getMyAssignedOrders, updateMyAssignmentStatus, reorderAssignments } from '../../controllers/delivery/order.controller.js';
import { protectDeliveryBoy } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply protection middleware to all order routes
router.use(protectDeliveryBoy);

router.get('/', getMyAssignedOrders);
router.put('/reorder', reorderAssignments);
router.put('/:assignmentId/status', updateMyAssignmentStatus);

export default router;
