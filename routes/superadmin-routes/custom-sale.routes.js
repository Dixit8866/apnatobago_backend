import express from 'express';
import { createCustomSale, getCustomSales, completeCustomSale } from '../../controllers/admin/customSale.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);
router.use(admin);

router.post('/', createCustomSale);
router.get('/', getCustomSales);
router.put('/:id/complete', completeCustomSale);

export default router;
