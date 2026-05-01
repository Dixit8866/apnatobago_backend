import { BusinessProfile } from '../../models/index.js';
import { uploadToS3 } from '../../utils/aws.s3.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';

/**
 * @desc    Get user business profile
 * @route   GET /api/user/business-profile
 * @access  Private
 */
export const getBusinessProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const profile = await BusinessProfile.findOne({ where: { userId } });

        if (!profile) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "No business profile found.", null);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Business profile fetched successfully.", profile);
    } catch (error) {
        logger.error(`[Get Business Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Create or update business profile
 * @route   POST /api/user/business-profile
 * @access  Private
 */
export const upsertBusinessProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        let body = { ...req.body };

        // Helper to ensure data is a string for TEXT fields if it comes as an object
        const ensureString = (val) => {
            if (typeof val === 'object' && val !== null) {
                return JSON.stringify(val);
            }
            return val;
        };

        const shopName = body.shopName;
        const gstNumber = body.gstNumber;
        const shopAddress = ensureString(body.shopAddress);
        const city = body.city;
        const postcode = body.postcode;

        // Image Handling
        let bannerImage = body.bannerImage;
        let profileImage = body.profileImage;

        if (req.files) {
            if (req.files.bannerImage) {
                const file = req.files.bannerImage[0];
                const uploadResult = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                if (uploadResult.success) {
                    bannerImage = uploadResult.url;
                } else {
                    logger.error(`[Banner Image Upload Error]: ${uploadResult.error}`);
                }
            }
            if (req.files.profileImage) {
                const file = req.files.profileImage[0];
                const uploadResult = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                if (uploadResult.success) {
                    profileImage = uploadResult.url;
                } else {
                    logger.error(`[Profile Image Upload Error]: ${uploadResult.error}`);
                }
            }
        }

        if (!shopName || !shopAddress || !city || !postcode) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: shopName, shopAddress, city, postcode.");
        }

        let profile = await BusinessProfile.findOne({ where: { userId } });

        const profileData = {
            shopName,
            gstNumber,
            shopAddress,
            city,
            postcode
        };

        // Only update images if provided (either as URL in body or as file)
        if (bannerImage !== undefined) profileData.bannerImage = bannerImage;
        if (profileImage !== undefined) profileData.profileImage = profileImage;

        if (profile) {
            await profile.update(profileData);
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Business profile updated successfully.", profile);
        } else {
            profile = await BusinessProfile.create({
                userId,
                ...profileData
            });
            return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Business profile created successfully.", profile);
        }
    } catch (error) {
        logger.error(`[Upsert Business Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Partial update of business profile
 * @route   PATCH /api/user/business-profile
 * @access  Private
 */
export const updateBusinessProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const profile = await BusinessProfile.findOne({ where: { userId } });

        if (!profile) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Business profile not found.");
        }

        let updateData = { ...req.body };

        // Handle Image Uploads for PATCH
        if (req.files) {
            if (req.files.bannerImage) {
                const file = req.files.bannerImage[0];
                const uploadResult = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                if (uploadResult.success) updateData.bannerImage = uploadResult.url;
            }
            if (req.files.profileImage) {
                const file = req.files.profileImage[0];
                const uploadResult = await uploadToS3(file.buffer, file.originalname, file.mimetype);
                if (uploadResult.success) updateData.profileImage = uploadResult.url;
            }
        }

        // Ensure shopAddress is a string if provided
        if (updateData.shopAddress) {
            if (typeof updateData.shopAddress === 'object' && updateData.shopAddress !== null) {
                updateData.shopAddress = JSON.stringify(updateData.shopAddress);
            }
        }

        await profile.update(updateData);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Business profile updated successfully.", profile);
    } catch (error) {
        logger.error(`[Update Business Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
