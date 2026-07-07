import express from 'express';
import {
    loginGodownStaff,
    logoutGodownStaff,
    getGodownStaffProfile,
} from '../../controllers/godown-panel/auth.controller.js';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';

const router = express.Router();

/**
 * @desc    Godown Staff Auth Routes
 * /api/godown-panel/auth
 */

router.post('/login', loginGodownStaff);
router.post('/logout', logoutGodownStaff);
router.get('/profile', protectGodownStaff, getGodownStaffProfile);

export default router;
