import express from 'express';
import {
    getPublicAppNotice,
    getAdminAppNotice,
    updateAdminAppNotice
} from '../../controllers/admin/appNotice.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Public endpoint for mobile app developers to show popup
router.get('/public', getPublicAppNotice);

// Protected endpoints for Admin Panel
router.get('/admin', protect, admin, getAdminAppNotice);
router.put('/admin', protect, admin, updateAdminAppNotice);

export default router;
