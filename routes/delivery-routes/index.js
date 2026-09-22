import express from 'express';
import authRoutes from './auth.routes.js';
import orderRoutes from './order.routes.js';
import paymentRoutes from './payment.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import userRoutes from './user.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/orders', orderRoutes);
router.use('/order', orderRoutes); // Support singular /order path
router.use('/user/orders', orderRoutes); // Support Flutter team's custom concatenated path
router.use('/notice', orderRoutes); // Support direct /notice/resolve and /notice/decline
router.use('/party-notice', orderRoutes); // Support direct /party-notice/resolve and /party-notice/decline
router.use('/payments', paymentRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/users', userRoutes);

export default router;
