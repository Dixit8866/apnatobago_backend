import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config();

/**
 * File storage on our own server (AWS S3 is no longer used).
 *
 * MEDIA_DIR         folder that holds every uploaded file; served at /uploads (app.js)
 *                   default: <backend>/uploads
 * MEDIA_PUBLIC_URL  public address of this API, e.g. https://api.apnatobacco.com
 *                   → uploads return https://api.apnatobacco.com/uploads/<file>
 *                   (not set → "/uploads/<file>", same as the old local fallback)
 *
 * Function names stay uploadToS3 / deleteFromS3 so every caller keeps working unchanged.
 */
export const MEDIA_DIR = process.env.MEDIA_DIR
    ? path.resolve(process.env.MEDIA_DIR)
    : path.join(process.cwd(), 'uploads');

const PUBLIC_BASE = String(process.env.MEDIA_PUBLIC_URL || '').trim().replace(/\/+$/, '');

/** Full public link of a stored file name. */
export const mediaUrl = (fileName) => `${PUBLIC_BASE}/uploads/${fileName}`;

// Save an uploaded file on this server
export const uploadToS3 = async (fileBuffer, originalName, mimeType) => {
    try {
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const extension = path.extname(originalName || '') || '.mp3';
        const fileName = `${Date.now()}-${uniqueSuffix}${extension}`;

        await fs.promises.mkdir(MEDIA_DIR, { recursive: true });
        await fs.promises.writeFile(path.join(MEDIA_DIR, fileName), fileBuffer);

        return { success: true, url: mediaUrl(fileName), path: `uploads/${fileName}` };
    } catch (error) {
        console.error('[Upload Error] Could not save file:', error.message);
        return { success: false, error: error.message };
    }
};

/**
 * File name inside MEDIA_DIR for any link we have stored over time:
 * https://api.apnatobacco.com/uploads/x.webp, the old https://apnatobacco.s3...amazonaws.com/uploads/x.webp,
 * /uploads/x.webp, uploads/x.webp or x.webp. Only the file name is used, so nothing outside MEDIA_DIR is touched.
 */
const fileNameFromKey = (fileKey) => {
    let key = String(fileKey || '').trim();
    if (!key) return null;
    if (/^https?:\/\//i.test(key)) {
        try { key = new URL(key).pathname; } catch { return null; }
    }
    try { key = decodeURIComponent(key); } catch { /* keep as is */ }
    const name = path.basename(key.split('?')[0]);
    return name && name !== '.' && name !== '..' ? name : null;
};

// Delete a stored file from this server
export const deleteFromS3 = async (fileKey) => {
    try {
        const name = fileNameFromKey(fileKey);
        if (!name) return { success: true };
        const filePath = path.join(MEDIA_DIR, name);
        if (fs.existsSync(filePath)) {
            await fs.promises.unlink(filePath);
        }
        return { success: true };
    } catch (error) {
        console.error('Delete Error:', error);
        return { success: false, error: error.message };
    }
};
