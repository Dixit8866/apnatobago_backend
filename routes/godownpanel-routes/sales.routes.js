import express from 'express';
import { getGodownOrders, updateGodownOrderStatus, bulkUpdateGodownOrderStatus, bulkAssignGodownOrders, mergeGodownOrders, getGodownMergeableOrders } from '../../controllers/godown-panel/sales.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Sales / Orders Routes
 * /api/godown-panel/sales
 */
router.get('/', protectGodownStaff, getGodownOrders);
router.post('/merge', protectGodownStaff, mergeGodownOrders);
router.get('/:id/mergeable', protectGodownStaff, getGodownMergeableOrders);
router.put('/bulk-status', protectGodownStaff, bulkUpdateGodownOrderStatus);
router.put('/bulk-assign', protectGodownStaff, bulkAssignGodownOrders);
router.patch('/:id/status', protectGodownStaff, updateGodownOrderStatus);

export default router;
