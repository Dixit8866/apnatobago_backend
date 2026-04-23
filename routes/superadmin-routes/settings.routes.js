import express from 'express';
import { getAppSettings, updateAppSettings } from '../../controllers/superadmin/settings.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect); // Only admins can access settings

router.get('/', getAppSettings);
router.put('/', updateAppSettings);

export default router;
