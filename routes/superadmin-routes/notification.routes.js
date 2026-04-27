import express from 'express';
import {
    sendNotification,
    getAllNotifications,
    deleteNotification
} from '../../controllers/admin/notification.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getAllNotifications);

router.post('/send', sendNotification);

router.route('/:id')
    .delete(deleteNotification);

export default router;
