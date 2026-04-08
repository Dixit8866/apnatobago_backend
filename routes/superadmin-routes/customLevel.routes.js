import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createCustomLevel,
    getCustomLevels,
    getCustomLevelById,
    updateCustomLevel,
    deleteCustomLevel,
} from '../../controllers/admin/customLevel.controller.js';

const router = express.Router();

router.post('/', protect, admin, createCustomLevel);
router.get('/', protect, admin, getCustomLevels);
router.get('/:id', protect, admin, getCustomLevelById);
router.put('/:id', protect, admin, updateCustomLevel);
router.delete('/:id', protect, admin, deleteCustomLevel);

export default router;
