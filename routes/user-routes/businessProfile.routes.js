import express from 'express';
import { 
    getBusinessProfile, 
    upsertBusinessProfile, 
    updateBusinessProfile 
} from '../../controllers/user/businessProfile.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';

import multer from 'multer';

const router = express.Router();

// Memory storage to process files
const storage = multer.memoryStorage();
const upload = multer({ 
    storage, 
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// All routes require authentication
router.use(protectUser);

router.get('/', getBusinessProfile);

// Handle multiple file fields
const uploadFields = upload.fields([
    { name: 'bannerImage', maxCount: 1 },
    { name: 'profileImage', maxCount: 1 }
]);

router.post('/', uploadFields, upsertBusinessProfile);
router.put('/', uploadFields, upsertBusinessProfile);
router.patch('/', uploadFields, updateBusinessProfile);

export default router;
