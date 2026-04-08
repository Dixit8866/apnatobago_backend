import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import logger from '../logger/apiLogger.js';

// Load directly from environment variables
const s3Client = new S3Client({
    region: process.env.PROD_AWS_REGION || 'ap-southeast-2',
    credentials: {
        accessKeyId: process.env.PROD_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.PROD_AWS_SECRET_ACCESS_KEY,
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'ordereasey';

/**
 * Upload a file to AWS S3
 * @param {Object} file - Express multer file object
 * @param {String} folder - Folder name in S3 bucket
 * @returns {Promise<String>} s3 URL
 */
export const uploadToS3 = async (file, folder = 'uploads') => {
    try {
        const fileExtension = file.originalname.split('.').pop();
        const fileName = `${folder}/${Date.now()}-${Math.round(Math.random() * 1E9)}.${fileExtension}`;

        const params = {
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            // To make URL directly accessible, depends on bucket policy. We assume bucket is public read or we return regular S3 URL
        };

        const command = new PutObjectCommand(params);
        await s3Client.send(command);

        const fileUrl = `https://${BUCKET_NAME}.s3.ap-southeast-2.amazonaws.com/${fileName}`;
        logger.info(`[S3 Upload] Successfully uploaded file to: ${fileUrl}`);
        
        return fileUrl;
    } catch (error) {
        logger.error(`[S3 Upload] Failed: ${error.message}`);
        throw new Error('Failed to upload file to S3');
    }
};
