import express from 'express';
import { getDailyCallings, getInactiveParties, logOrUpdateCall } from '../../controllers/godown-panel/partyCalling.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Party Calling Routes
 * /api/godown-panel/party-calling
 */
router.get('/daily', protectGodownStaff, getDailyCallings);
router.get('/inactive', protectGodownStaff, getInactiveParties);
router.post('/log', protectGodownStaff, logOrUpdateCall);

export default router;
