import express from 'express';
import { getGodownPayments, bulkVerifyPayments } from '../../controllers/godown-panel/payment.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Payment Routes
 * /api/godown-panel/payments
 */
router.get('/', protectGodownStaff, getGodownPayments);
router.put('/bulk-verify', protectGodownStaff, bulkVerifyPayments);

export default router;
