import express from 'express';
import { getOrderBlockSetting, updateOrderBlockSetting } from '../../controllers/superadmin/orderBlock.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect); // Only admins can access these settings

router.get('/', getOrderBlockSetting);
router.put('/', updateOrderBlockSetting);

export default router;
