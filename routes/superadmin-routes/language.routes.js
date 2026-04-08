import express from 'express';
import {
    createLanguage,
    getLanguages,
    getLanguageById,
    updateLanguage,
    deleteLanguage
} from '../../controllers/admin/language.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/', protect, admin, createLanguage);
router.get('/', protect, admin, getLanguages);
router.get('/:id', protect, admin, getLanguageById);
router.put('/:id', protect, admin, updateLanguage);
router.delete('/:id', protect, admin, deleteLanguage);

export default router;
