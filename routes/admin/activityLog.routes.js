import express from 'express';
import {
    getActivityLogs,
    getActivityLogModules,
    getActivityLogStats,
    getActivityLogUsers
} from '../../controllers/admin/activityLog.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.get('/', getActivityLogs);
router.get('/modules', getActivityLogModules);
router.get('/stats', getActivityLogStats);
router.get('/users', getActivityLogUsers);

export default router;
