import { Op } from 'sequelize';
import User from '../../models/user/User.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import { Order, OrderItem, Product } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

const SAFE_ATTRIBUTES = { exclude: ['password', 'logintoken', 'fcmtoken'] };

export const createUser = async (req, res, next) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, showtabacco, creditline, blockcredit, applevel, status, kycverification } = req.body;

        if (!fullname || !number || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Fullname, number, and password are required.');
        }

        const existing = await User.findOne({ where: { number } });
        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'User with this number already exists.');
        }

        // Handle Default App Level (Basic)
        let finalAppLevel = applevel;
        if (!finalAppLevel) {
            const basicLevel = await CustomLevel.findOne({ 
                where: { name: { [Op.iLike]: 'Basic' } } 
            });
            if (basicLevel) {
                finalAppLevel = basicLevel.id;
            }
        }

        const user = await User.create({
            fullname, email, dialcode: dialcode || '+91', number, city, postcode, password,
            showtabacco: showtabacco ?? false,
            creditline: creditline || 0,
            blockcredit: blockcredit ?? false,
            applevel: finalAppLevel || null,
            status: status || 'Active',
            kycverification: kycverification || 'pending',
        });

        const safeUser = await User.findByPk(user.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'User created successfully.', safeUser);
    } catch (error) {
        next(error);
    }
};

export const getAllUsers = async (req, res, next) => {
    try {
        const { page = 1, limit = 50, search = '', status, kycverification } = req.query;
        const { limit: limitOptions, offset } = getPaginationOptions(page, limit);

        const where = {};
        if (search) {
            where[Op.or] = [
                { fullname: { [Op.iLike]: `%${search}%` } },
                { number: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
            ];
        }
        if (status) where.status = status;
        if (kycverification) where.kycverification = kycverification;

        if (req.query.paginate === 'false') {
            const users = await User.findAll({ where, attributes: SAFE_ATTRIBUTES, order: [['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Users fetched.', users);
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            attributes: SAFE_ATTRIBUTES,
            limit: limitOptions,
            offset,
            order: [['createdAt', 'DESC']],
        });

        const responseData = formatPaginatedResponse({ count, rows }, page, limitOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Users fetched.', responseData);
    } catch (error) {
        next(error);
    }
};

export const getUserById = async (req, res, next) => {
    try {
        const user = await User.findByPk(req.params.id, { 
            attributes: SAFE_ATTRIBUTES,
            include: [{ model: CustomLevel, as: 'rewardLevel', attributes: ['id', 'name'] }]
        });
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User fetched.', user);
    } catch (error) {
        next(error);
    }
};

export const updateUser = async (req, res, next) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, showtabacco, creditline, blockcredit, applevel, status, kycverification } = req.body;
        const user = await User.findByPk(req.params.id);
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');

        if (number && number !== user.number) {
            const existing = await User.findOne({ where: { number } });
            if (existing) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Number already in use.');
        }

        const updateData = {
            fullname: fullname ?? user.fullname,
            email: email ?? user.email,
            dialcode: dialcode ?? user.dialcode,
            number: number ?? user.number,
            city: city ?? user.city,
            postcode: postcode ?? user.postcode,
            showtabacco: showtabacco !== undefined ? showtabacco : user.showtabacco,
            creditline: creditline !== undefined ? creditline : user.creditline,
            blockcredit: blockcredit !== undefined ? blockcredit : user.blockcredit,
            applevel: (applevel === '' || applevel === undefined) ? (applevel === '' ? null : user.applevel) : applevel,
            status: status ?? user.status,
            kycverification: kycverification ?? user.kycverification,
        };
        if (password) updateData.password = password;

        await user.update(updateData);
        const updated = await User.findByPk(user.id, { attributes: SAFE_ATTRIBUTES });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User updated.', updated);
    } catch (error) {
        next(error);
    }
};

export const deleteUser = async (req, res, next) => {
    try {
        const user = await User.findByPk(req.params.id);
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');
        
        // Soft delete
        user.status = 'Deleted';
        await user.save();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User deleted successfully.');
    } catch (error) {
        next(error);
    }
};

export const getUserAnalytics = async (req, res, next) => {
    try {
        const userId = req.params.id;
        const user = await User.findByPk(userId, { 
            attributes: SAFE_ATTRIBUTES,
            include: [{ model: CustomLevel, as: 'rewardLevel', attributes: ['id', 'name'] }]
        });
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');

        const totalOrders = await Order.count({
            where: { userId, orderStatus: { [Op.ne]: 'Cancelled' } }
        });

        const totalSpent = await Order.sum('totalAmount', {
            where: { userId, orderStatus: { [Op.ne]: 'Cancelled' } }
        }) || 0;

        const recentOrders = await Order.findAll({
            where: { userId, orderStatus: { [Op.ne]: 'Cancelled' } },
            order: [['createdAt', 'DESC']],
            limit: 5,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [{ model: Product, as: 'product', attributes: ['name'] }]
                }
            ]
        });

        const avgOrderValue = totalOrders > 0 ? Math.round(totalSpent / totalOrders) : 0;
        const lastOrderDate = recentOrders.length > 0 ? recentOrders[0].createdAt : null;

        const analytics = {
            user,
            stats: {
                totalSpent,
                totalOrders,
                avgOrderValue,
                lastOrderDate,
                preferredCategory: 'N/A'
            },
            recentOrders
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User analytics fetched.', analytics);
    } catch (error) {
        next(error);
    }
};
