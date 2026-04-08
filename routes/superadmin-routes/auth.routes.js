import express from 'express';
import {
    registerAdmin,
    loginAdmin,
    logoutAdmin,
    getAdminProfile,
} from '../../controllers/admin/auth.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';
import { validateRegister } from '../../validators/auth.validator.js';

const router = express.Router();

/**
 * @desc    Auth Routes
 * /api/auth
 */

router.post('/register', validateRegister, registerAdmin);
router.post('/login', loginAdmin);
router.post('/logout', logoutAdmin); // ADDED: Logout API
router.get('/profile', protect, getAdminProfile);

export default router;
