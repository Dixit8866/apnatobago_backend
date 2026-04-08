import express from 'express';
import multer from 'multer';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import { uploadImage, removeImage } from '../../controllers/admin/upload.controller.js';

const router = express.Router();

// Memory storage to process file via SDK buffer
const storage = multer.memoryStorage();
const upload = multer({ 
    storage, 
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

router.post('/', protect, admin, upload.single('image'), uploadImage);
router.delete('/', protect, admin, removeImage);

export default router;
