import express from 'express';
import { 
    getAllOrders, 
    updateOrderStatus, 
    getOrderDetails 
} from '../../controllers/admin/order.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require Admin authentication
router.use(protect);

router.get('/', getAllOrders);
router.get('/:id', getOrderDetails);
router.put('/:id/status', updateOrderStatus);

export default router;
