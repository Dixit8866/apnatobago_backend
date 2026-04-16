import express from 'express';
import {
    createMainCategory,
    getMainCategories,
    getMainCategoryById,
    updateMainCategory,
    deleteMainCategory,
    reorderMainCategories,
    moveMainCategoryToTop
} from '../../controllers/admin/mainCategory.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createMainCategory);
router.get('/', protect, admin, getMainCategories);
router.get('/:id', protect, admin, getMainCategoryById);
router.put('/:id', protect, admin, updateMainCategory);
router.delete('/:id', protect, admin, deleteMainCategory);
router.post('/reorder', protect, admin, reorderMainCategories);
router.post('/:id/move-to-top', protect, admin, moveMainCategoryToTop);

export default router;
