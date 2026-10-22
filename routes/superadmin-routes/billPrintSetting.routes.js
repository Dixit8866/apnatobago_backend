import express from 'express';
import { getBillPrintSetting, updateBillPrintSetting } from '../../controllers/admin/billPrintSetting.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Public read: the bill is also printed from the public invoice page (only volume names, nothing private)
router.get('/', getBillPrintSetting);
router.put('/', protect, admin, updateBillPrintSetting);

export default router;
