import express from 'express';
import {
    getPartyLedgerHandler,
    syncPartyLedgerHandler,
    addManualPartyEntryHandler
} from '../../controllers/admin/partyLedger.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/:userId', getPartyLedgerHandler);
router.post('/:userId/sync', syncPartyLedgerHandler);
router.post('/:userId/manual-entry', addManualPartyEntryHandler);

export default router;
