import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createCompanyCategory,
    getCompanyCategories,
    getCompanyCategoryById,
    updateCompanyCategory,
    deleteCompanyCategory
} from '../../controllers/admin/companyCategory.controller.js';

const router = express.Router();

router.post('/', protect, admin, createCompanyCategory);
router.get('/', protect, admin, getCompanyCategories);
router.get('/:id', protect, admin, getCompanyCategoryById);
router.put('/:id', protect, admin, updateCompanyCategory);
router.delete('/:id', protect, admin, deleteCompanyCategory);

export default router;
