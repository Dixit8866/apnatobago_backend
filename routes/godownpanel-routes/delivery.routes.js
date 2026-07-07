import express from 'express';
import { getGodownDeliveryBoys } from '../../controllers/godown-panel/delivery.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Delivery Routes
 * /api/godown-panel/delivery
 */
router.get('/', protectGodownStaff, getGodownDeliveryBoys);

export default router;
