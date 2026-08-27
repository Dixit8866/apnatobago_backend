import express from 'express';
import { getAllPayments, updatePaymentSubmission, getDailyReconciliationReport, updateOrderCollectionDetails } from '../../controllers/admin/payment.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/daily-reconciliation-report', getDailyReconciliationReport);
router.put('/order/:orderId/collection', updateOrderCollectionDetails);
router.get('/', getAllPayments);
router.put('/:id/submit', updatePaymentSubmission);

export default router;
