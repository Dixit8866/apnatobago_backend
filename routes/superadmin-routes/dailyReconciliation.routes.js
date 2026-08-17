import express from 'express';
import {
    getLiveReconciliation,
    settleDay,
    getReconciliationHistory
} from '../../controllers/admin/dailyReconciliation.controller.js';
import { protectAdmin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protectAdmin);

router.get('/live', getLiveReconciliation);
router.post('/settle', settleDay);
router.get('/history', getReconciliationHistory);

export default router;
