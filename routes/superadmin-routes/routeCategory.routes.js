import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createRouteCategory,
    getRouteCategories,
    getRouteCategoryById,
    updateRouteCategory,
    deleteRouteCategory
} from '../../controllers/admin/routeCategory.controller.js';

const router = express.Router();

router.post('/', protect, admin, createRouteCategory);
router.get('/', protect, admin, getRouteCategories);
router.get('/:id', protect, admin, getRouteCategoryById);
router.put('/:id', protect, admin, updateRouteCategory);
router.delete('/:id', protect, admin, deleteRouteCategory);

export default router;
