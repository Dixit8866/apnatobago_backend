import express from 'express';
import {
    createGodown,
    getGodowns,
    getGodownById,
    updateGodown,
    deleteGodown
} from '../../controllers/admin/godownController.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// Protect all godown routes
router.use(protect, admin);

router.post('/', createGodown);
router.get('/', getGodowns);
router.get('/:id', getGodownById);
router.put('/:id', updateGodown);
router.delete('/:id', deleteGodown);

export default router;

