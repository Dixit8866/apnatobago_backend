import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    getOrderReport,
    getTopSellingReport,
    getPartyReport,
    getInventoryReport,
    getPurchaseReport,
    getProductMasterReport,
    getPaymentCollectionReport,
    getPaymentReconciliationReport,
    getPurchaseVsSalesAnalytics
} from '../../controllers/admin/report.controller.js';

const router = express.Router();

// All reports are protected and require admin privileges
router.use(protect, admin);

router.get('/orders', getOrderReport);
router.get('/top-selling', getTopSellingReport);
router.get('/parties', getPartyReport);
router.get('/inventory', getInventoryReport);
router.get('/purchase', getPurchaseReport);
router.get('/products', getProductMasterReport);
router.get('/payment-collection', getPaymentCollectionReport);
router.get('/payment-reconciliation', getPaymentReconciliationReport);
router.get('/purchase-vs-sales', getPurchaseVsSalesAnalytics);

export default router;
