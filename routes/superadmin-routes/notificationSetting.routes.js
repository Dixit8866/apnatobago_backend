import express from 'express';
import {
    getNotificationSettings,
    updateNotificationSettings
} from '../../controllers/admin/notificationSetting.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getNotificationSettings)
    .put(admin, updateNotificationSettings);

export default router;
