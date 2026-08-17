import { AppNoticeSetting } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';

/**
 * Get App Notice for Customer Mobile App (Public / User API)
 */
export const getPublicAppNotice = async (req, res, next) => {
    try {
        let notice = await AppNoticeSetting.findOne({
            order: [['createdAt', 'DESC']]
        });

        if (!notice) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'No active notice popup.', {
                isActive: false,
                notice: null
            });
        }

        const now = new Date();
        let isScheduledActive = notice.isActive;

        if (notice.fromDate && new Date(notice.fromDate) > now) {
            isScheduledActive = false;
        }

        if (notice.toDate && new Date(notice.toDate) < now) {
            isScheduledActive = false;
        }

        if (!isScheduledActive) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'App notice is currently disabled.', {
                isActive: false,
                notice: null
            });
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Active app notice fetched successfully.', {
            isActive: true,
            notice: {
                id: notice.id,
                title: notice.title || '',
                description: notice.description || '',
                imageUrl: notice.imageUrl || '',
                buttonText: notice.buttonText || 'ઓકે (OK)',
                buttonLink: notice.buttonLink || ''
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get App Notice Settings for Admin Panel
 */
export const getAdminAppNotice = async (req, res, next) => {
    try {
        let [notice] = await AppNoticeSetting.findOrCreate({
            where: {},
            defaults: {
                isActive: false,
                title: 'તમારી ડિલિવરી અંગે સૂચના',
                description: 'હવામાન અથવા તકનીકી કારણોસર ડિલિવરીમાં થોડો વિલંબ થઈ શકે છે. સહકાર બદલ આભાર.',
                imageUrl: '',
                buttonText: 'ઓકે (OK)',
                buttonLink: ''
            }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Admin app notice settings fetched.', notice);
    } catch (error) {
        next(error);
    }
};

/**
 * Update App Notice Settings from Admin Panel
 */
export const updateAdminAppNotice = async (req, res, next) => {
    try {
        const {
            isActive = false,
            title = '',
            description = '',
            imageUrl = '',
            buttonText = 'ઓકે (OK)',
            buttonLink = '',
            fromDate = null,
            toDate = null
        } = req.body;

        let [notice] = await AppNoticeSetting.findOrCreate({
            where: {},
            defaults: {
                isActive,
                title,
                description,
                imageUrl,
                buttonText,
                buttonLink,
                fromDate,
                toDate
            }
        });

        notice.isActive = Boolean(isActive);
        notice.title = String(title || '').trim();
        notice.description = String(description || '').trim();
        notice.imageUrl = String(imageUrl || '').trim();
        notice.buttonText = String(buttonText || 'ઓકે (OK)').trim();
        notice.buttonLink = String(buttonLink || '').trim();
        notice.fromDate = fromDate ? new Date(fromDate) : null;
        notice.toDate = toDate ? new Date(toDate) : null;

        await notice.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'App Notice settings updated successfully.', notice);
    } catch (error) {
        next(error);
    }
};
