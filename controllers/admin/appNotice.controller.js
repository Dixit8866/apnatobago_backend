import { AppNoticeSetting } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendSuccessResponse } from '../../utils/response.util.js';

/**
 * Get App Notice for Customer Mobile App (Public / User API)
 */
export const getPublicAppNotice = async (req, res, next) => {
    try {
        let notice = await AppNoticeSetting.findOne({
            order: [['updatedAt', 'DESC']]
        });

        if (!notice) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'No active notice popup.', {
                isActive: false,
                notice: null
            });
        }

        const now = new Date();
        let isScheduledActive = Boolean(notice.isActive);

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
        let notice = await AppNoticeSetting.findOne({
            order: [['updatedAt', 'DESC']]
        });

        if (!notice) {
            notice = await AppNoticeSetting.create({
                isActive: false,
                title: '',
                description: '',
                imageUrl: '',
                buttonText: 'ઓકે (OK)',
                buttonLink: ''
            });
        }

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

        let notice = await AppNoticeSetting.findOne({
            order: [['updatedAt', 'DESC']]
        });

        const updatedFields = {
            isActive: Boolean(isActive),
            title: String(title || '').trim(),
            description: String(description || '').trim(),
            imageUrl: String(imageUrl || '').trim(),
            buttonText: String(buttonText || 'ઓકે (OK)').trim(),
            buttonLink: String(buttonLink || '').trim(),
            fromDate: fromDate ? new Date(fromDate) : null,
            toDate: toDate ? new Date(toDate) : null
        };

        if (!notice) {
            notice = await AppNoticeSetting.create(updatedFields);
        } else {
            Object.assign(notice, updatedFields);
            await notice.save();
        }

        // Update all records in table to ensure complete consistency
        await AppNoticeSetting.update(updatedFields, { where: {} });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'App Notice settings updated successfully.', notice);
    } catch (error) {
        next(error);
    }
};
