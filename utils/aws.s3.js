import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config();

const s3Client = new S3Client({
    region: process.env.PROD_AWS_REGION || 'ap-southeast-2',
    credentials: {
        accessKeyId: process.env.PROD_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.PROD_AWS_SECRET_ACCESS_KEY,
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

// Upload file to S3 with local disk fallback
export const uploadToS3 = async (fileBuffer, originalName, mimeType) => {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const extension = path.extname(originalName) || '.mp3';
    const relativeFileName = `uploads/${Date.now()}-${uniqueSuffix}${extension}`;

    // 1. Try S3 upload if configured
    if (BUCKET_NAME && process.env.PROD_AWS_ACCESS_KEY_ID && process.env.PROD_AWS_SECRET_ACCESS_KEY) {
        try {
            const command = new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: relativeFileName,
                Body: fileBuffer,
                ContentType: mimeType,
            });

            await s3Client.send(command);

            const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.PROD_AWS_REGION || 'ap-southeast-2'}.amazonaws.com/${relativeFileName}`;
            return { success: true, url: fileUrl, path: relativeFileName };
        } catch (error) {
            console.warn("[S3 Upload Notice] S3 service error, switching to local disk storage:", error.message);
        }
    }

    // 2. Local Disk Fallback (guaranteed to succeed in dev or if S3 is unavailable)
    try {
        const uploadDir = path.join(process.cwd(), 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        const localFileName = `${Date.now()}-${uniqueSuffix}${extension}`;
        const localFilePath = path.join(uploadDir, localFileName);
        fs.writeFileSync(localFilePath, fileBuffer);

        const localUrl = `/uploads/${localFileName}`;
        console.log(`[Upload Success] File saved to local storage: ${localUrl}`);
        return { success: true, url: localUrl, path: `uploads/${localFileName}` };
    } catch (localErr) {
        console.error("Local upload fallback error:", localErr);
        return { success: false, error: localErr.message };
    }
};

// Delete file from S3 or local storage
export const deleteFromS3 = async (fileKey) => {
    try {
        let key = fileKey;
        if (fileKey && fileKey.startsWith('http')) {
            const url = new URL(fileKey);
            key = url.pathname.replace(/^\//, '');
        }

        // Check if local file
        if (key && (key.startsWith('uploads/') || !key.includes('//'))) {
            const localPath = path.join(process.cwd(), key);
            if (fs.existsSync(localPath)) {
                try { fs.unlinkSync(localPath); } catch {}
                return { success: true };
            }
        }

        if (BUCKET_NAME) {
            const command = new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
            });
            await s3Client.send(command);
        }
        return { success: true };
    } catch (error) {
        console.error("Delete Error:", error);
        return { success: false, error: error.message };
    }
};
