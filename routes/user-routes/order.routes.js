import express from 'express';
import { 
    createOrder, 
    getOrders, 
    getOrderDetails, 
    cancelOrder 
} from '../../controllers/user/order.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protectUser);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/:id', getOrderDetails);
router.put('/:id/cancel', cancelOrder);

export default router;
