import { BusinessProfile } from '../../models/index.js';
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
        
        // Handle multipart data: if fields are JSON strings, parse them
        let body = { ...req.body };
        
        // Helper to parse JSON strings safely
        const safeParse = (val) => {
            if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
                try { return JSON.parse(val); } catch (e) { return val; }
            }
            return val;
        };

        const shopName = body.shopName;
        const gstNumber = body.gstNumber;
        const shopAddress = safeParse(body.shopAddress);
        const city = body.city;
        const postcode = body.postcode;

        // Image Handling: Support both URL strings in body OR file uploads in req.files
        let bannerImage = body.bannerImage;
        let profileImage = body.profileImage;

        if (req.files) {
            if (req.files.bannerImage) {
                // If it's an array of files (from multer/s3 middleware)
                bannerImage = req.files.bannerImage[0].location || req.files.bannerImage[0].path;
            }
            if (req.files.profileImage) {
                profileImage = req.files.profileImage[0].location || req.files.profileImage[0].path;
            }
        }

        if (!shopName || !shopAddress || !city || !postcode) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: shopName, shopAddress, city, postcode.");
        }

        let profile = await BusinessProfile.findOne({ where: { userId } });

        const profileData = {
            bannerImage,
            profileImage,
            shopName,
            gstNumber,
            shopAddress,
            city,
            postcode
        };

        if (profile) {
            // Update existing profile
            await profile.update(profileData);
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Business profile updated successfully.", profile);
        } else {
            // Create new profile
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

        await profile.update(req.body);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Business profile updated successfully.", profile);
    } catch (error) {
        logger.error(`[Update Business Profile Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
