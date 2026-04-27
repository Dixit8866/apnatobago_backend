import express from 'express';
import { 
    submitHelpRequest, 
    getMyHelpRequests 
} from '../../controllers/user/helpSupport.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(protectUser);

router.post('/', submitHelpRequest);
router.get('/', getMyHelpRequests);

export default router;
