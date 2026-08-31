import express from 'express';
import { createOutletOrder, getOutletOrders, getOutletOrderById, updateOutletOrderStatus, updateOutletOrder, deleteOutletOrder } from '../../controllers/admin/outletOrder.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(admin);

router.post('/', createOutletOrder);
router.get('/', getOutletOrders);
router.get('/:id', getOutletOrderById);
router.put('/:id', updateOutletOrder);
router.put('/:id/status', updateOutletOrderStatus);
router.delete('/:id', deleteOutletOrder);

export default router;
