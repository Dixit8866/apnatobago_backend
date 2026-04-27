import express from 'express';
import { 
    getAllHelpRequests, 
    updateHelpRequestStatus 
} from '../../controllers/admin/helpSupport.controller.js';
import { protect } from '../../middlewares/auth.middleware.js';

const router = express.Router();

// All routes require Admin authentication
router.use(protect);

router.get('/', getAllHelpRequests);
router.put('/:id/status', updateHelpRequestStatus);

export default router;
