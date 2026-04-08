import { uploadToS3, deleteFromS3 } from '../../utils/aws.s3.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';

export const uploadImage = async (req, res, next) => {
    try {
        if (!req.file) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No file uploaded.");
        }

        const result = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);

        if (!result.success) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to upload to S3.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Image uploaded successfully.", { url: result.url, path: result.path });
    } catch (error) {
        next(error);
    }
};

export const removeImage = async (req, res, next) => {
    try {
        const { key_path } = req.body;
        if (!key_path) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Image path or URL is required.");
        }

        const result = await deleteFromS3(key_path);

        if (!result.success) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Failed to delete image from S3.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Image deleted successfully.");
    } catch (error) {
        next(error);
    }
};
