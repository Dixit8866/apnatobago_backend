import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    getInventoryOptions,
    getInventoryStocks,
    getInventoryStockById,
    getInventorySummary,
    getInventoryTransactions,
    createPurchaseTransaction,
    createSaleTransaction,
    updateInventoryStock,
    deleteInventoryStock,
} from '../../controllers/admin/inventory.controller.js';

const router = express.Router();

router.get('/options', protect, admin, getInventoryOptions);
router.get('/stocks', protect, admin, getInventoryStocks);
router.get('/stocks/:id', protect, admin, getInventoryStockById);
router.get('/summary', protect, admin, getInventorySummary);
router.get('/transactions', protect, admin, getInventoryTransactions);
router.post('/transactions/purchase', protect, admin, createPurchaseTransaction);
router.post('/transactions/sale', protect, admin, createSaleTransaction);
router.put('/stocks/:id', protect, admin, updateInventoryStock);
router.delete('/stocks/:id', protect, admin, deleteInventoryStock);

export default router;
