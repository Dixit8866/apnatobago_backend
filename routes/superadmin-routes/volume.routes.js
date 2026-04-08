import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createVolume,
    getVolumes,
    getVolumeById,
    updateVolume,
    deleteVolume
} from '../../controllers/admin/volume.controller.js';

const router = express.Router();

router.post('/', protect, admin, createVolume);
router.get('/', protect, admin, getVolumes);
router.get('/:id', protect, admin, getVolumeById);
router.put('/:id', protect, admin, updateVolume);
router.delete('/:id', protect, admin, deleteVolume);

export default router;
