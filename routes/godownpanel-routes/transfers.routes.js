import express from 'express';
import {
    getTransfers,
    getTransferById,
    createTransfer,
    updateTransferStatus,
    getActiveGodowns,
    getGodownStock
} from '../../controllers/common/transfers.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Apply staff auth middleware to all transfer routes
router.use(protectGodownStaff);

router.get('/', getTransfers);
router.post('/', createTransfer);
router.get('/godowns/list', getActiveGodowns);
router.get('/godown-stock/:godownId', getGodownStock);
router.get('/:id', getTransferById);
router.put('/:id/status', updateTransferStatus);

export default router;
