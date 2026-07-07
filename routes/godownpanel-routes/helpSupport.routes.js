import express from 'express';
import { getGodownHelpSupport, updateGodownHelpSupportStatus } from '../../controllers/godown-panel/helpSupport.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Help & Support Routes
 * /api/godown-panel/help-support
 */
router.get('/', protectGodownStaff, getGodownHelpSupport);
router.patch('/:id/status', protectGodownStaff, updateGodownHelpSupportStatus);

export default router;
