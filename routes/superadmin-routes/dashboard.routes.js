import express from 'express';
import { getDashboardStats } from '../../controllers/admin/dashboard.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/stats', protect, getDashboardStats);

export default router;
