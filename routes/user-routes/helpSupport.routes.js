import express from 'express';
import multer from 'multer';
import { 
    submitHelpRequest, 
    getMyHelpRequests 
} from '../../controllers/user/helpSupport.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

const router = express.Router();

// Memory storage to process files via SDK buffer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage, 
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// All routes require authentication
router.use(protectUser);

router.post('/', upload.single('image'), submitHelpRequest);
router.get('/', getMyHelpRequests);

export default router;
