import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const s3Client = new S3Client({
    region: process.env.PROD_AWS_REGION,
    credentials: {
        accessKeyId: process.env.PROD_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.PROD_AWS_SECRET_ACCESS_KEY,
    }
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

// Upload file to S3
export const uploadToS3 = async (fileBuffer, originalName, mimeType) => {
    try {
        const uniqueSuffix = crypto.randomBytes(16).toString('hex');
        const extension = path.extname(originalName);
        const fileName = `uploads/${Date.now()}-${uniqueSuffix}${extension}`;

        const command = new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileName,
            Body: fileBuffer,
            ContentType: mimeType,
            // ACL: 'public-read' // Usually let the bucket assume public or you return the exact url if policy allows reads
        });

        await s3Client.send(command);

        // Generate the public URL
        const fileUrl = `https://${BUCKET_NAME}.s3.${process.env.PROD_AWS_REGION}.amazonaws.com/${fileName}`;
        
        return { success: true, url: fileUrl, path: fileName };
    } catch (error) {
        console.error("S3 Upload Error:", error);
        return { success: false, error: error.message };
    }
};

// Delete file from S3
export const deleteFromS3 = async (fileKey) => {
    try {
        // Extract key if a URL is provided
        let key = fileKey;
        if (fileKey.startsWith('http')) {
             const url = new URL(fileKey);
             key = url.pathname.substring(1); // remove leading slash
        }

        const command = new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        });

        await s3Client.send(command);
        return { success: true };
    } catch (error) {
        console.error("S3 Delete Error:", error);
        return { success: false, error: error.message };
    }
};
