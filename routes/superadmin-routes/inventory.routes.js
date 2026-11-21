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
import {
    getStockSummary,
    getStockLedger,
    getProductLots,
    createStockAdjustment,
    getStockMeta,
    getCutoffs,
    startCutoff,
    cancelCutoff,
    getCutoffChecklist,
    getCutoffCounts,
    saveCutoffCounts,
    postCutoffOpening,
    resolveLegacyHold,
    getStockEdit,
    saveStockEdit,
    removeFromLot,
} from '../../controllers/admin/stock.controller.js';

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

// Stock ledger screens
router.get('/stock-meta', protect, admin, getStockMeta);
router.get('/stock-summary', protect, admin, getStockSummary);
router.get('/stock-ledger', protect, admin, getStockLedger);
router.get('/stock-lots', protect, admin, getProductLots);
router.post('/stock-lots/:id/remove', protect, admin, removeFromLot);
router.post('/stock-adjust', protect, admin, createStockAdjustment);
router.get('/stock-edit', protect, admin, getStockEdit);
router.put('/stock-edit', protect, admin, saveStockEdit);

// Cut-off (Opening stock)
router.get('/cutoffs', protect, admin, getCutoffs);
router.post('/cutoffs', protect, admin, startCutoff);
router.delete('/cutoffs/:id', protect, admin, cancelCutoff);
router.get('/cutoffs/:id/checklist', protect, admin, getCutoffChecklist);
router.get('/cutoffs/:id/counts', protect, admin, getCutoffCounts);
router.put('/cutoffs/:id/counts', protect, admin, saveCutoffCounts);
router.post('/cutoffs/:id/post', protect, admin, postCutoffOpening);
router.post('/cutoff-holds/:variantId', protect, admin, resolveLegacyHold);

export default router;
