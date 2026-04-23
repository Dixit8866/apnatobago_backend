import express from 'express';
import * as purchaseController from '../../controllers/admin/purchase.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.get('/', purchaseController.getPurchaseBills);
router.get('/:id', purchaseController.getPurchaseBillById);
router.post('/convert', purchaseController.convertToBill);

export default router;
