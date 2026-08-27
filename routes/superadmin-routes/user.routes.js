import express from 'express';
import * as userController from '../../controllers/admin/user.controller.js';
import { updateUserLocation } from '../../controllers/common/userLocation.controller.js';
import { protect, admin } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.use(protect, admin);

router.post('/', userController.createUser);
router.get('/', userController.getAllUsers);
router.get('/:id', userController.getUserById);
router.get('/:id/analytics', userController.getUserAnalytics);
router.put('/:id', userController.updateUser);
router.put('/:id/location', updateUserLocation);
router.patch('/:id/assign-godown', userController.assignUserGodown);
router.post('/:id/balance-adjustment', userController.adjustPartyBalance);
router.get('/:id/balance-logs', userController.getPartyBalanceLogs);
router.put('/balance-logs/:logId', userController.updatePartyBalanceLog);
router.delete('/balance-logs/:logId', userController.deletePartyBalanceLog);
router.delete('/:id', userController.deleteUser);

export default router;
