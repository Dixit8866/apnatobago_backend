import express from 'express';
import { protectGodownStaff, godownAdmin } from '../../middlewares/auth.middleware.js';
import {
    createStaff,
    getAllStaff,
    getStaffById,
    updateStaff,
    deleteStaff,
} from '../../controllers/godown-panel/staff.controller.js';

const router = express.Router();

// Using godown panel specific protect and admin (godownAdmin)
router.post('/',      protectGodownStaff, godownAdmin, createStaff);
router.get('/',       protectGodownStaff, getAllStaff); // Read can be allowed for staff too
router.get('/:id',    protectGodownStaff, getStaffById);
router.put('/:id',    protectGodownStaff, godownAdmin, updateStaff);
router.delete('/:id', protectGodownStaff, godownAdmin, deleteStaff);

export default router;
