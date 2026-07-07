import express from 'express';
import { getGodownDashboard } from '../../controllers/godown-panel/dashboard.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Dashboard Routes
 * /api/godown-panel/dashboard
 */
router.get('/', protectGodownStaff, getGodownDashboard);

export default router;
