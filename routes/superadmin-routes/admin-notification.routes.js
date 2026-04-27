import express from 'express';
import {
    getAdminNotifications,
    markAsRead,
    markAllAsRead
} from '../../controllers/admin/adminNotification.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.get('/', getAdminNotifications);
router.put('/read-all', markAllAsRead);
router.put('/:id/read', markAsRead);

export default router;
