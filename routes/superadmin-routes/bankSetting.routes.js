import express from 'express';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import {
    createBankSetting,
    getBankSettings,
    getBankSettingById,
    updateBankSetting,
    deleteBankSetting
} from '../../controllers/admin/bankSetting.controller.js';

const router = express.Router();

router.post('/', protect, admin, createBankSetting);
router.get('/', protect, admin, getBankSettings);
router.get('/:id', protect, admin, getBankSettingById);
router.put('/:id', protect, admin, updateBankSetting);
router.delete('/:id', protect, admin, deleteBankSetting);

export default router;
