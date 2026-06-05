import express from 'express';
import { getUserNotifications } from '../../controllers/user/notification.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

router.use(protectUser);

router.get('/', getUserNotifications);

export default router;
