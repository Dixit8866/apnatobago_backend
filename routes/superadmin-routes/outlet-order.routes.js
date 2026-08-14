import express from 'express';
import { createOutletOrder, getOutletOrders, getOutletOrderById } from '../../controllers/admin/outletOrder.controller.js';
import { protect, admin } from '../../middleware/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(admin);

router.post('/', createOutletOrder);
router.get('/', getOutletOrders);
router.get('/:id', getOutletOrderById);

export default router;
