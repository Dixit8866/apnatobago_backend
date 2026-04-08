import express from 'express';
import multer from 'multer';
import { protectGodownStaff } from '../../middlewares/auth.middleware.js';
import { uploadImage, removeImage } from '../../controllers/godown-panel/upload.controller.js';

const router = express.Router();

// Memory storage to process file via SDK buffer
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Any logged in godown staff/admin can upload/delete images for their profile/records
router.post('/', protectGodownStaff, upload.single('image'), uploadImage);
router.delete('/', protectGodownStaff, removeImage);

export default router;
