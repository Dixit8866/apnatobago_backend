import express from 'express';
import authRoutes from './auth.routes.js';
import orderRoutes from './order.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/orders', orderRoutes);

export default router;
