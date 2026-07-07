import express from 'express';
import { getGodownInventory, getGodownInventoryLogs, getGodownInventorySummary } from '../../controllers/godown-panel/inventory.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Inventory Routes
 * /api/godown-panel/inventory
 */
router.get('/', protectGodownStaff, getGodownInventory);
router.get('/summary', protectGodownStaff, getGodownInventorySummary);
router.get('/logs', protectGodownStaff, getGodownInventoryLogs);

export default router;
