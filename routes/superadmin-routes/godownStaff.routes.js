import express from 'express';
import {
    createGodownStaff,
    getGodownStaffs,
    getGodownStaffById,
    updateGodownStaff,
    deleteGodownStaff
} from '../../controllers/admin/godownStaffController.js';

const router = express.Router();

router.post('/', createGodownStaff);
router.get('/', getGodownStaffs);
router.get('/:id', getGodownStaffById);
router.put('/:id', updateGodownStaff);
router.delete('/:id', deleteGodownStaff);

export default router;
