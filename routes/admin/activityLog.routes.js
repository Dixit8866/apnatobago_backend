import express from 'express';
import {
    getActivityLogs,
    getActivityLogModules,
    getActivityLogStats
} from '../../controllers/admin/activityLog.controller.js';
import { authenticateSuperAdmin } from '../../middlewares/superadmin.middleware.js';

const router = express.Router();

router.use(authenticateSuperAdmin);

router.get('/', getActivityLogs);
router.get('/modules', getActivityLogModules);
router.get('/stats', getActivityLogStats);

export default router;
