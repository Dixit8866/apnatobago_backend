import express from 'express';
import { getCart, addToCart, updateCartItem, removeFromCart, clearCart } from '../../controllers/user/cart.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All cart routes are protected for users
router.use(protectUser);

router.get('/', getCart);
router.post('/', addToCart);
router.put('/:id', updateCartItem);
router.delete('/clear', clearCart);
router.delete('/:id', removeFromCart);

export default router;
