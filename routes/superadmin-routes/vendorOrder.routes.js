import express from 'express';
import * as vendorOrderController from '../../controllers/admin/vendorOrder.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.post('/', vendorOrderController.createVendorOrder);
router.get('/', vendorOrderController.getAllVendorOrders);
router.get('/:id', vendorOrderController.getVendorOrderById);
router.put('/:id', vendorOrderController.updateVendorOrder);
router.delete('/:id', vendorOrderController.deleteVendorOrder);

export default router;
