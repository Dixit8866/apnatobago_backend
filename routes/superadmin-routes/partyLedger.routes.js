import {
    getPartyLedgerHandler,
    syncPartyLedgerHandler,
    addManualPartyEntryHandler,
    getPartyLedgerEditHistoryHandler,
    updatePartyLedgerTransactionHandler,
    updatePartyOpeningBalanceHandler
} from '../../controllers/admin/partyLedger.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/:userId', getPartyLedgerHandler);
router.get('/:userId/history/:billNo', getPartyLedgerEditHistoryHandler);
router.put('/:userId/transaction', updatePartyLedgerTransactionHandler);
router.put('/:userId/opening-balance', updatePartyOpeningBalanceHandler);
router.post('/:userId/sync', syncPartyLedgerHandler);
router.post('/:userId/manual-entry', addManualPartyEntryHandler);

export default router;
