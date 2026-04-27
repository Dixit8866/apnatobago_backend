import { DeliveryBoy } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { Op } from 'sequelize';

/**
 * @desc    Get all delivery boys with pagination and search
 * @route   GET /api/admin/delivery-boys
 */
export const getAllDeliveryBoys = async (req, res) => {
    try {
        const { search, status } = req.query;
        const where = {};

        if (status) {
            where.status = status;
        }

        if (search) {
            where[Op.or] = [
                { name: { [Op.iLike]: `%${search}%` } },
                { phone: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } }
            ];
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await DeliveryBoy.findAndCountAll({
            where,
            limit,
            offset,
            order: [['createdAt', 'DESC']]
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Delivery boys fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get Delivery Boys Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get single delivery boy by ID
 * @route   GET /api/admin/delivery-boys/:id
 */
export const getDeliveryBoyById = async (req, res) => {
    try {
        const { id } = req.params;
        const boy = await DeliveryBoy.findByPk(id);

        if (!boy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Delivery boy not found.");
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Delivery boy details fetched successfully.", boy);
    } catch (error) {
        logger.error(`[Get Delivery Boy By ID Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Create new delivery boy
 * @route   POST /api/admin/delivery-boys
 */
export const createDeliveryBoy = async (req, res) => {
    try {
        const { name, phone, email, password, address, vehicleNumber, salary, profileImage, status } = req.body;

        // Check if phone already exists
        const existingBoy = await DeliveryBoy.findOne({ where: { phone } });
        if (existingBoy) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Phone number already registered.");
        }

        if (email) {
            const existingEmail = await DeliveryBoy.findOne({ where: { email } });
            if (existingEmail) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Email already registered.");
            }
        }

        const newBoy = await DeliveryBoy.create({
            name,
            phone,
            email,
            password,
            address,
            vehicleNumber,
            salary,
            profileImage,
            status: status || 'Active'
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Delivery boy created successfully.", newBoy);
    } catch (error) {
        logger.error(`[Create Delivery Boy Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update delivery boy
 * @route   PUT /api/admin/delivery-boys/:id
 */
export const updateDeliveryBoy = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, password, address, vehicleNumber, salary, profileImage, status } = req.body;

        const boy = await DeliveryBoy.findByPk(id);
        if (!boy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Delivery boy not found.");
        }

        // Check unique constraints if phone/email changed
        if (phone && phone !== boy.phone) {
            const existingPhone = await DeliveryBoy.findOne({ where: { phone } });
            if (existingPhone) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Phone number already in use.");
        }

        if (email && email !== boy.email) {
            const existingEmail = await DeliveryBoy.findOne({ where: { email } });
            if (existingEmail) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Email already in use.");
        }

        await boy.update({
            name,
            phone,
            email,
            password: password || boy.password,
            address,
            vehicleNumber,
            salary,
            profileImage,
            status
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Delivery boy updated successfully.", boy);
    } catch (error) {
        logger.error(`[Update Delivery Boy Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Soft delete delivery boy
 * @route   DELETE /api/admin/delivery-boys/:id
 */
export const deleteDeliveryBoy = async (req, res) => {
    try {
        const { id } = req.params;
        const boy = await DeliveryBoy.findByPk(id);

        if (!boy) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Delivery boy not found.");
        }

        await boy.destroy(); // Soft delete due to paranoid: true
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Delivery boy deleted successfully.");
    } catch (error) {
        logger.error(`[Delete Delivery Boy Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
