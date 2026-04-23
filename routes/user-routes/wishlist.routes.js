import express from 'express';
import { getWishlist, addToWishlist, removeFromWishlist } from '../../controllers/user/wishlist.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All wishlist routes are protected
router.use(protectUser);

router.get('/', getWishlist);
router.post('/', addToWishlist);
router.delete('/:id', removeFromWishlist);
router.delete('/', removeFromWishlist); // For query param removal

export default router;
