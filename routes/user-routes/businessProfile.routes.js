import express from 'express';
import { 
    getBusinessProfile, 
    upsertBusinessProfile, 
    updateBusinessProfile 
} from '../../controllers/user/businessProfile.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protectUser);

router.get('/', getBusinessProfile);
router.post('/', upsertBusinessProfile);
router.put('/', upsertBusinessProfile); // Alias for convenience
router.patch('/', updateBusinessProfile);

export default router;
