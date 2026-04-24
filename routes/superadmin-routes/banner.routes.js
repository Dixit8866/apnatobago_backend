import express from 'express';
import {
    createBanner,
    getBanners,
    getBannerById,
    updateBanner,
    deleteBanner,
    reorderBanners,
    moveBannerToTop
} from '../../controllers/admin/banner.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createBanner);
router.get('/', protect, admin, getBanners);
router.get('/:id', protect, admin, getBannerById);
router.put('/:id', protect, admin, updateBanner);
router.delete('/:id', protect, admin, deleteBanner);
router.post('/reorder', protect, admin, reorderBanners);
router.post('/:id/move-to-top', protect, admin, moveBannerToTop);

export default router;
