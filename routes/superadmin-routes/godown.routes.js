import express from 'express';
import {
    createGodown,
    getGodowns,
    getGodownById,
    updateGodown,
    deleteGodown
} from '../../controllers/admin/godownController.js';

const router = express.Router();

router.post('/', createGodown);
router.get('/', getGodowns);
router.get('/:id', getGodownById);
router.put('/:id', updateGodown);
router.delete('/:id', deleteGodown);

export default router;
