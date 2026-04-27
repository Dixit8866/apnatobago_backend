import express from 'express';
import {
    getAllDeliveryBoys,
    getDeliveryBoyById,
    createDeliveryBoy,
    updateDeliveryBoy,
    deleteDeliveryBoy
} from '../../controllers/admin/deliveryBoy.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// All routes are protected by admin auth
router.use(protect);

router.route('/')
    .get(getAllDeliveryBoys)
    .post(createDeliveryBoy);

router.route('/:id')
    .get(getDeliveryBoyById)
    .put(updateDeliveryBoy)
    .delete(deleteDeliveryBoy);

export default router;
