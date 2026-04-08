import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createProduct,
    getProducts,
    getProductById,
    updateProduct,
    deleteProduct,
} from '../../controllers/admin/product.controller.js';

const router = express.Router();

router.post('/', protect, admin, createProduct);
router.get('/', protect, admin, getProducts);
router.get('/:id', protect, admin, getProductById);
router.put('/:id', protect, admin, updateProduct);
router.delete('/:id', protect, admin, deleteProduct);

export default router;
