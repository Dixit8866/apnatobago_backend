import express from 'express';
import {
    getAllOrders,
    updateOrderStatus,
    getOrderDetails,
    downloadInvoice,
    downloadDeliveryLabel,
    bulkUpdateOrderStatus,
    bulkVerifyPayments,
    updateOrderItem,
    addOrderItem,
    deleteOrderItem
} from '../../controllers/admin/order.controller.js';
import { getSalesReturns, approveSalesReturn } from '../../controllers/common/salesReturn.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Define specific routes first with individual protect middleware to prevent route clashing with public /:id wildcard
router.get('/sales-returns', protect, getSalesReturns);

// Public route for order invoice / details view
router.get('/:id', getOrderDetails);

// All subsequent routes require Admin authentication
router.use(protect);

router.put('/sales-returns/:id/approve', approveSalesReturn);
router.get('/', getAllOrders);
router.get('/:id/invoice', downloadInvoice);
router.get('/:id/delivery-label', downloadDeliveryLabel);
router.put('/bulk-status', bulkUpdateOrderStatus);
router.put('/bulk-verify-payments', bulkVerifyPayments);
router.put('/:id/status', updateOrderStatus);
router.put('/:id/items/:itemId', updateOrderItem);
router.post('/:id/items', addOrderItem);
router.delete('/:id/items/:itemId', deleteOrderItem);

export default router;