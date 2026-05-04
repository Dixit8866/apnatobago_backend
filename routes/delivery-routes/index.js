import express from 'express';
import authRoutes from './auth.routes.js';
import orderRoutes from './order.routes.js';
import paymentRoutes from './payment.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/orders', orderRoutes);
router.use('/payments', paymentRoutes);

export default router;
