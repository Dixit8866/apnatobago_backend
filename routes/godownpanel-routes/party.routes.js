import express from 'express';
import { getGodownParties, getGodownPartyById, updateGodownParty } from '../../controllers/godown-panel/party.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Party Routes
 * /api/godown-panel/parties
 */
router.get('/', protectGodownStaff, getGodownParties);
router.get('/:id', protectGodownStaff, getGodownPartyById);
router.patch('/:id', protectGodownStaff, updateGodownParty);

export default router;
