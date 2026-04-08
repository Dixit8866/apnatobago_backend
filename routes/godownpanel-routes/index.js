import express from 'express';
import authRoutes from './auth.routes.js';
import uploadRoutes from './upload.routes.js';
import staffRoutes from './staff.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/upload', uploadRoutes);
router.use('/staff', staffRoutes);

export default router;
