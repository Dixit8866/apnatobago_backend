import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createSubCategory,
    getSubCategories,
    getSubCategoryById,
    updateSubCategory,
    deleteSubCategory
} from '../../controllers/admin/subCategory.controller.js';

const router = express.Router();

router.post('/', protect, admin, createSubCategory);
router.get('/', protect, admin, getSubCategories);
router.get('/:id', protect, admin, getSubCategoryById);
router.put('/:id', protect, admin, updateSubCategory);
router.delete('/:id', protect, admin, deleteSubCategory);

export default router;
