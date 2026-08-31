import express from 'express';
import {
    getAllOrders,
    updateOrderStatus,
    getOrderDetails,
    downloadInvoice,
    downloadDeliveryLabel,
    bulkUpdateOrderStatus,
    bulkVerifyPayments,
    verifyAndSettleOrder,
    updateOrderItem,
    addOrderItem,
    deleteOrderItem,
    mergeOrders,
    getMergeableOrders,
    getUserCarts,
    deleteUserCartItem,
    clearUserCart,
    getCustomerPaymentsReport
} from '../../controllers/admin/order.controller.js';
import { getSalesReturns, approveSalesReturn, approveAllSalesReturnByOrder, getPartyOrdersForReturn, createAdminSalesReturn, updateCompanyReturnStatus } from '../../controllers/common/salesReturn.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Define specific routes first with individual protect middleware to prevent route clashing with public /:id wildcard
router.get('/customer-payments-report', protect, getCustomerPaymentsReport);
router.get('/user-carts', protect, getUserCarts);
router.delete('/user-carts/clear/:userId', protect, clearUserCart);
router.delete('/user-carts/:cartId', protect, deleteUserCartItem);
router.get('/sales-returns', protect, getSalesReturns);
router.post('/sales-returns/direct', protect, createAdminSalesReturn);
router.put('/sales-returns/:id/company-status', protect, updateCompanyReturnStatus);
router.get('/party/:userId/orders-for-return', protect, getPartyOrdersForReturn);
router.post('/merge', protect, mergeOrders);
router.get('/:id/mergeable', protect, getMergeableOrders);

// Public route for order invoice / details view
router.get('/:id', getOrderDetails);

// All subsequent routes require Admin authentication
router.use(protect);

router.put('/sales-returns/:id/approve', approveSalesReturn);
router.put('/sales-returns/approve-all/:orderId', protect, approveAllSalesReturnByOrder);
router.get('/', getAllOrders);
router.get('/:id/invoice', downloadInvoice);
router.get('/:id/delivery-label', downloadDeliveryLabel);
router.put('/bulk-status', bulkUpdateOrderStatus);
router.put('/bulk-verify-payments', bulkVerifyPayments);
router.put('/:id/verify-settlement', verifyAndSettleOrder);
router.put('/:id/status', updateOrderStatus);
router.put('/:id/items/:itemId', updateOrderItem);
router.post('/:id/items', addOrderItem);
router.delete('/:id/items/:itemId', deleteOrderItem);

export default router;