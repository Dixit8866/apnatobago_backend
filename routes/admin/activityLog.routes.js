import express from 'express';
import {
    getActivityLogs,
    getActivityLogModules,
    getActivityLogStats
} from '../../controllers/admin/activityLog.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.get('/', getActivityLogs);
router.get('/modules', getActivityLogModules);
router.get('/stats', getActivityLogStats);

export default router;
