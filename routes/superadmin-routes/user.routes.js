import express from 'express';
import * as userController from '../../controllers/admin/user.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.post('/', userController.createUser);
router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.get('/:id/analytics', userController.getUserAnalytics);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);

export default router;
