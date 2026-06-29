import express from 'express';
import * as partyCallingController from '../../controllers/admin/partyCalling.controller.js';

const router = express.Router();

router.get('/inactive', partyCallingController.getInactivePartyCalls);
router.get('/', partyCallingController.getDailyPartyCalls);
router.post('/log', partyCallingController.logOrUpdateCall);

export default router;
