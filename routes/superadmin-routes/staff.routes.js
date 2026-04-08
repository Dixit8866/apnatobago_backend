import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createStaff,
    getAllStaff,
    getStaffById,
    updateStaff,
    deleteStaff,
} from '../../controllers/admin/staff.controller.js';

const router = express.Router();

router.post('/',     protect, admin, createStaff);
router.get('/',      protect, admin, getAllStaff);
router.get('/:id',   protect, admin, getStaffById);
router.put('/:id',   protect, admin, updateStaff);
router.delete('/:id', protect, admin, deleteStaff);

export default router;
