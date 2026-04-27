import express from 'express';
import { 
    getAllOrders, 
    updateOrderStatus, 
    getOrderDetails,
    downloadInvoice,
    downloadDeliveryLabel
} from '../../controllers/admin/order.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require Admin authentication
router.use(protect);

router.get('/', getAllOrders);
router.get('/:id', getOrderDetails);
router.get('/:id/invoice', downloadInvoice);
router.get('/:id/delivery-label', downloadDeliveryLabel);
router.put('/:id/status', updateOrderStatus);

export default router;
