import express from 'express';
import {
    createOffer,
    getOffers,
    getOfferById,
    updateOffer,
    deleteOffer,
    reorderOffers,
    moveOfferToTop
} from '../../controllers/admin/offer.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createOffer);
router.get('/', protect, admin, getOffers);
router.get('/:id', protect, admin, getOfferById);
router.put('/:id', protect, admin, updateOffer);
router.delete('/:id', protect, admin, deleteOffer);
router.post('/reorder', protect, admin, reorderOffers);
router.post('/:id/move-to-top', protect, admin, moveOfferToTop);

export default router;
