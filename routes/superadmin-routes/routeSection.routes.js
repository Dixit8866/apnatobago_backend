import express from 'express';
import {
    createRouteSection,
    getRouteSections,
    getRouteSectionById,
    updateRouteSection,
    deleteRouteSection
} from '../../controllers/admin/routeSection.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createRouteSection);
router.get('/', protect, admin, getRouteSections);
router.get('/:id', protect, admin, getRouteSectionById);
router.put('/:id', protect, admin, updateRouteSection);
router.delete('/:id', protect, admin, deleteRouteSection);

export default router;
