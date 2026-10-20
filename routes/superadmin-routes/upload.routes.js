import express from 'express';
import multer from 'multer';
import { protect, admin } from '../../middlewares/auth.middleware.js';
import { uploadImage, removeImage } from '../../controllers/admin/upload.controller.js';

const router = express.Router();

// Memory storage to process file via SDK buffer
const storage = multer.memoryStorage();

const allowedMimeTypes = [
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp',
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/x-m4a', 'audio/m4a'
];

const fileFilter = (req, file, cb) => {
    const ext = (file.originalname || '').toLowerCase();
    const isAudioExt = /\.(mp3|wav|ogg|m4a|aac)$/i.test(ext);
    const isImageExt = /\.(png|jpe?g|webp)$/i.test(ext);

    if (allowedMimeTypes.includes(file.mimetype) || isAudioExt || isImageExt) {
        cb(null, true);
    } else {
        cb(new Error('Only PNG, JPG, JPEG, WebP images and MP3, WAV, OGG, M4A audio files are allowed.'), false);
    }
};

const upload = multer({ 
    storage,
    fileFilter,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

router.post('/', protect, admin, upload.any(), uploadImage);
router.delete('/', protect, admin, removeImage);

export default router;
