import express from 'express';
import {
    createGodownStaff,
    getGodownStaffs,
    getGodownStaffById,
    updateGodownStaff,
    deleteGodownStaff
} from '../../controllers/admin/godownStaffController.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Protect all godown staff routes
router.use(protect, admin);

router.post('/', createGodownStaff);
router.get('/', getGodownStaffs);
router.get('/:id', getGodownStaffById);
router.put('/:id', updateGodownStaff);
router.delete('/:id', deleteGodownStaff);

export default router;

