import express from 'express';
import {
    createSellingVolume,
    getSellingVolumes,
    getSellingVolumeById,
    updateSellingVolume,
    deleteSellingVolume
} from '../../controllers/admin/sellingVolume.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createSellingVolume);
router.get('/', protect, admin, getSellingVolumes);
router.get('/:id', protect, admin, getSellingVolumeById);
router.put('/:id', protect, admin, updateSellingVolume);
router.delete('/:id', protect, admin, deleteSellingVolume);

export default router;
