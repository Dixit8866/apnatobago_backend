import express from 'express';
import multer from 'multer';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import { uploadImage, removeImage } from '../../controllers/admin/upload.controller.js';

const router = express.Router();

// Memory storage to process file via SDK buffer
const storage = multer.memoryStorage();

const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

const fileFilter = (req, file, cb) => {
    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Only PNG, JPG, JPEG, WebP images are allowed.'), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: { fileSize: 3 * 1024 * 1024 } // 3MB limit
});

router.post('/', protect, admin, upload.single('image'), uploadImage);
router.delete('/', protect, admin, removeImage);

export default router;
