import express from 'express';
import {
    createRole,
    getRoles,
    getRoleById,
    updateRole,
    deleteRole
} from '../../controllers/admin/adminRole.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createRole);
router.get('/', protect, admin, getRoles);
router.get('/:id', protect, admin, getRoleById);
router.put('/:id', protect, admin, updateRole);
router.delete('/:id', protect, admin, deleteRole);

export default router;
