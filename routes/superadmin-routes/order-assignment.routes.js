import express from 'express';
import {
    bulkAssignOrders,
    getAllAssignments,
    updateAssignment,
    deleteAssignment
} from '../../controllers/admin/orderAssignment.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect);

router.route('/')
    .get(getAllAssignments);

router.post('/bulk', bulkAssignOrders);

router.route('/:id')
    .put(updateAssignment)
    .delete(deleteAssignment);

export default router;
