import { Op } from 'sequelize';
import User from '../../models/user/User.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import { Order, OrderItem, Product, BusinessProfile, RouteCategory, AppSettings, Cart, Wishlist, PartyCalling, HelpSupport, SalesReturn, Godown, PartyBalanceLog } from '../../models/index.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

const SAFE_ATTRIBUTES = { exclude: ['password', 'logintoken', 'fcmtoken'] };

export const createUser = async (req, res, next) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, showtabacco, creditline, blockcredit, applevel, status, kycverification, routeCategoryId, deliveryRoundId, latitude, longitude, godownId } = req.body;

        if (!fullname || !number || !password) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Fullname, number, and password are required.');
        }

        const existing = await User.findOne({ where: { number } });
        if (existing) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'User with this number already exists.');
        }

        // Handle Default App Level (Premium)
        let finalAppLevel = applevel;
        if (!finalAppLevel) {
            finalAppLevel = '6b0722c6-ee28-4058-b4de-a961d1b16da0';
        }

        let resolvedDeliveryRoundTiming = null;
        if (deliveryRoundId && deliveryRoundId !== 'none') {
            const settings = await AppSettings.findOne();
            let matched = false;
            if (settings && Array.isArray(settings.deliveryRoundSchedules) && settings.deliveryRoundSchedules.length > 0) {
                const normalizedSchedules = settings.deliveryRoundSchedules.map((round, index) => ({
                    id: round.id || `round_${index + 1}`,
                    ...round
                }));
                const matchedRound = normalizedSchedules.find(r => r.id === deliveryRoundId);
                if (matchedRound) {
                    resolvedDeliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                    matched = true;
                }
            }
            if (!matched) {
                const morningStart = settings?.morningDeliveryStart || '08:00';
                const morningEnd = settings?.morningDeliveryEnd || '13:00';
                const eveningStart = settings?.eveningDeliveryStart || '15:00';
                const eveningEnd = settings?.eveningDeliveryEnd || '17:00';

                if (deliveryRoundId === 'morning_round_1') {
                    resolvedDeliveryRoundTiming = `${morningStart} - ${morningEnd}`;
                } else if (deliveryRoundId === 'evening_round_1') {
                    resolvedDeliveryRoundTiming = `${eveningStart} - ${eveningEnd}`;
                }
            }
        }

        const user = await User.create({
            fullname, email, dialcode: dialcode || '+91', number, city, postcode, password,
            showtabacco: showtabacco ?? false,
            creditline: creditline || 0,
            blockcredit: blockcredit ?? false,
            applevel: finalAppLevel || null,
            routeCategoryId: routeCategoryId || null,
            deliveryRoundId: (deliveryRoundId === 'none' || !deliveryRoundId) ? null : deliveryRoundId,
            deliveryRoundTiming: resolvedDeliveryRoundTiming,
            status: status || 'Active',
            kycverification: kycverification || 'pending',
            orderReminder: true,
            reminderTime: '09:00 PM',
            latitude: (latitude === '' || latitude === undefined || latitude === null) ? null : parseFloat(latitude),
            longitude: (longitude === '' || longitude === undefined || longitude === null) ? null : parseFloat(longitude),
            godownId: godownId || null,
        });

        // Handle Business Profile if provided
        const { shopName, shopNameAlt, gstNumber, shopAddress, businessCity, businessPostcode } = req.body;
        if (shopName || shopAddress) {
            await BusinessProfile.create({
                userId: user.id,
                shopName: shopName || fullname,
                shopNameAlt: shopNameAlt || '',
                gstNumber,
                shopAddress: shopAddress || city || '',
                city: businessCity || city || '',
                postcode: businessPostcode || postcode || '',
            });
        }

        const safeUser = await User.findByPk(user.id, { attributes: SAFE_ATTRIBUTES });

        logActivity(req, {
            module: 'Party Management',
            action: 'CREATE',
            description: `Created new Customer/Party "${fullname}" (${number})`,
            metadata: { userId: user.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'User created successfully.', safeUser);
    } catch (error) {
        next(error);
    }
};

export const getAllUsers = async (req, res, next) => {
    try {
        const { page = 1, limit = 50, search = '', status, kycverification, routeCategoryId, deliveryRoundTiming, godownId } = req.query;
        const { limit: limitOptions, offset } = getPaginationOptions(req.query);

        const searchWhere = {};
        if (search) {
            searchWhere[Op.or] = [
                { fullname: { [Op.iLike]: `%${search}%` } },
                { number: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$businessProfile.shopNameAlt$': { [Op.iLike]: `%${search}%` } }
            ];
        }
        if (kycverification) searchWhere.kycverification = kycverification;
        if (routeCategoryId) {
            if (typeof routeCategoryId === 'string' && routeCategoryId.includes(',')) {
                searchWhere.routeCategoryId = { [Op.in]: routeCategoryId.split(',') };
            } else {
                searchWhere.routeCategoryId = routeCategoryId;
            }
        }
        if (deliveryRoundTiming) searchWhere.deliveryRoundTiming = deliveryRoundTiming;
        if (godownId) searchWhere.godownId = godownId;

        const where = { ...searchWhere };
        if (status) where.status = status;

        const include = [
            {
                model: BusinessProfile,
                as: 'businessProfile',
                attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
            },
            {
                model: RouteCategory,
                as: 'routeCategory',
                attributes: ['id', 'name', 'pincode']
            },
            {
                model: Godown,
                as: 'assignedGodown',
                attributes: ['id', 'name']
            }
        ];

        // Parallel status counts (search and KYC aware, not status-filtered)
        const [totalCount, activeCount, inactiveCount, deletedCount] = await Promise.all([
            User.count({ where: searchWhere, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Active' }, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Inactive' }, include, distinct: true }),
            User.count({ where: { ...searchWhere, status: 'Deleted' }, include, distinct: true }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        // Calculate user counts by routeCategory for the currently active tab status, search and KYC status filters
        const routeCountWhere = { ...where };
        delete routeCountWhere.routeCategoryId;
        routeCountWhere.routeCategoryId = { [Op.ne]: null };

        const routeCountsRaw = await User.count({
            where: routeCountWhere,
            include,
            distinct: true,
            group: ['routeCategoryId']
        });

        const routeCounts = {};
        if (Array.isArray(routeCountsRaw)) {
            routeCountsRaw.forEach(r => {
                const id = r.routeCategoryId;
                if (id) {
                    routeCounts[id] = parseInt(r.count || 0, 10);
                }
            });
        }

        // Calculate user counts by deliveryRoundTiming for the currently active tab status, search and KYC status filters
        const timingCountWhere = { ...where };
        delete timingCountWhere.deliveryRoundTiming;
        timingCountWhere.deliveryRoundTiming = { [Op.ne]: null };

        const timingCountsRaw = await User.count({
            where: timingCountWhere,
            include,
            distinct: true,
            group: ['deliveryRoundTiming']
        });

        const timingCounts = {};
        if (Array.isArray(timingCountsRaw)) {
            timingCountsRaw.forEach(r => {
                const timing = r.deliveryRoundTiming;
                if (timing) {
                    timingCounts[timing] = parseInt(r.count || 0, 10);
                }
            });
        }

        // Calculate user counts by godownId
        const godownCountWhere = { ...where };
        delete godownCountWhere.godownId;
        godownCountWhere.godownId = { [Op.ne]: null };

        const godownCountsRaw = await User.count({
            where: godownCountWhere,
            include,
            distinct: true,
            group: ['godownId']
        });

        const godownCounts = {};
        if (Array.isArray(godownCountsRaw)) {
            godownCountsRaw.forEach(r => {
                const id = r.godownId;
                if (id) {
                    godownCounts[id] = parseInt(r.count || 0, 10);
                }
            });
        }

        if (req.query.paginate === 'false') {
            const users = await User.findAll({ 
                where, 
                attributes: SAFE_ATTRIBUTES, 
                include,
                order: [['createdAt', 'DESC']]
            });
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Users fetched.', users);
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            attributes: SAFE_ATTRIBUTES,
            include,
            limit: limitOptions,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const responseData = formatPaginatedResponse({ count, rows }, page, limitOptions);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Users fetched.', {
            ...responseData,
            statusCounts,
            routeCounts,
            timingCounts,
            godownCounts
        });
    } catch (error) {
        next(error);
    }
};

export const getUserById = async (req, res, next) => {
    try {
        const user = await User.findByPk(req.params.id, { 
            attributes: SAFE_ATTRIBUTES,
            include: [
                { model: CustomLevel, as: 'rewardLevel', attributes: ['id', 'name'] },
                { model: BusinessProfile, as: 'businessProfile' },
                { model: RouteCategory, as: 'routeCategory', attributes: ['id', 'name', 'pincode'] },
                { model: Godown, as: 'assignedGodown', attributes: ['id', 'name'] }
            ]
        });
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User fetched.', user);
    } catch (error) {
        next(error);
    }
};

export const updateUser = async (req, res, next) => {
    try {
        const { fullname, email, dialcode, number, city, postcode, password, showtabacco, creditline, blockcredit, applevel, status, kycverification, routeCategoryId, deliveryRoundId, latitude, longitude, godownId } = req.body;
        const user = await User.findByPk(req.params.id);
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');

        if (number && number !== user.number) {
            const existing = await User.findOne({ where: { number } });
            if (existing) return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Number already in use.');
        }

        let finalDeliveryRoundId = undefined;
        let finalDeliveryRoundTiming = undefined;

        if (deliveryRoundId !== undefined) {
            if (deliveryRoundId === '' || deliveryRoundId === null || deliveryRoundId === 'none') {
                finalDeliveryRoundId = null;
                finalDeliveryRoundTiming = null;
            } else {
                finalDeliveryRoundId = deliveryRoundId;
                const settings = await AppSettings.findOne();
                let matched = false;
                if (settings && Array.isArray(settings.deliveryRoundSchedules) && settings.deliveryRoundSchedules.length > 0) {
                    const normalizedSchedules = settings.deliveryRoundSchedules.map((round, index) => ({
                        id: round.id || `round_${index + 1}`,
                        ...round
                    }));
                    const matchedRound = normalizedSchedules.find(r => r.id === deliveryRoundId);
                    if (matchedRound) {
                        finalDeliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                        matched = true;
                    }
                }
                if (!matched) {
                    const morningStart = settings?.morningDeliveryStart || '08:00';
                    const morningEnd = settings?.morningDeliveryEnd || '13:00';
                    const eveningStart = settings?.eveningDeliveryStart || '15:00';
                    const eveningEnd = settings?.eveningDeliveryEnd || '17:00';

                    if (deliveryRoundId === 'morning_round_1') {
                        finalDeliveryRoundTiming = `${morningStart} - ${morningEnd}`;
                    } else if (deliveryRoundId === 'evening_round_1') {
                        finalDeliveryRoundTiming = `${eveningStart} - ${eveningEnd}`;
                    } else {
                        finalDeliveryRoundTiming = null;
                    }
                }
            }
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
            routeCategoryId: (routeCategoryId === '' || routeCategoryId === undefined) ? (routeCategoryId === '' ? null : user.routeCategoryId) : routeCategoryId,
            deliveryRoundId: finalDeliveryRoundId !== undefined ? finalDeliveryRoundId : user.deliveryRoundId,
            deliveryRoundTiming: finalDeliveryRoundTiming !== undefined ? finalDeliveryRoundTiming : user.deliveryRoundTiming,
            status: status ?? user.status,
            kycverification: kycverification ?? user.kycverification,
            latitude: (latitude === '' || latitude === undefined) ? (latitude === '' ? null : user.latitude) : (latitude === null ? null : parseFloat(latitude)),
            longitude: (longitude === '' || longitude === undefined) ? (longitude === '' ? null : user.longitude) : (longitude === null ? null : parseFloat(longitude)),
            godownId: (godownId === '' || godownId === undefined) ? (godownId === '' ? null : user.godownId) : godownId,
        };
        if (password) updateData.password = password;

        await user.update(updateData);

        // Handle Business Profile update
        const { shopName, shopNameAlt, gstNumber, shopAddress, businessCity, businessPostcode } = req.body;
        if (shopName || shopNameAlt || shopAddress || gstNumber || businessCity || businessPostcode) {
            const [profile, created] = await BusinessProfile.findOrCreate({
                where: { userId: user.id },
                defaults: {
                    shopName: shopName || user.fullname,
                    shopNameAlt: shopNameAlt || '',
                    gstNumber,
                    shopAddress: shopAddress || user.city || '',
                    city: businessCity || user.city || '',
                    postcode: businessPostcode || user.postcode || '',
                }
            });

            if (!created) {
                await profile.update({
                    shopName: shopName ?? profile.shopName,
                    shopNameAlt: shopNameAlt ?? profile.shopNameAlt,
                    gstNumber: gstNumber ?? profile.gstNumber,
                    shopAddress: shopAddress ?? profile.shopAddress,
                    city: businessCity ?? profile.city,
                    postcode: businessPostcode ?? profile.postcode,
                });
            }
        }

        const updatedUser = await User.findByPk(req.params.id, { 
            attributes: SAFE_ATTRIBUTES,
            include: [
                { model: BusinessProfile, as: 'businessProfile' },
                { model: RouteCategory, as: 'routeCategory', attributes: ['id', 'name', 'pincode'] },
                { model: Godown, as: 'assignedGodown', attributes: ['id', 'name'] }
            ]
        });

        logActivity(req, {
            module: 'Party Management',
            action: 'UPDATE',
            description: `Updated Customer/Party "${user.fullname}"`,
            metadata: { userId: user.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User updated successfully.', updatedUser);
    } catch (error) {
        next(error);
    }
};

export const deleteUser = async (req, res, next) => {
    const t = await User.sequelize.transaction();
    try {
        const user = await User.findByPk(req.params.id, { transaction: t });
        if (!user) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'User not found.');
        }

        const userName = user.fullname;
        
        // Delete associated records first to avoid foreign key issues
        await BusinessProfile.destroy({ where: { userId: user.id }, transaction: t });
        await Cart.destroy({ where: { userId: user.id }, transaction: t });
        await Wishlist.destroy({ where: { userId: user.id }, transaction: t });
        await PartyCalling.destroy({ where: { userId: user.id }, transaction: t });
        await HelpSupport.destroy({ where: { userId: user.id }, force: true, transaction: t });
        await SalesReturn.destroy({ where: { userId: user.id }, force: true, transaction: t });
        
        // Dissociate orders (setting userId to null)
        await Order.update({ userId: null }, { where: { userId: user.id }, transaction: t });
        
        // Now delete the user itself
        await user.destroy({ transaction: t });
        
        await t.commit();

        logActivity(req, {
            module: 'Party Management',
            action: 'DELETE',
            description: `Deleted Customer/Party "${userName}"`,
            metadata: { userId: req.params.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'User deleted completely from database.');
    } catch (error) {
        await t.rollback();
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

/**
 * @desc    Assign a party (user) to a specific godown
 * @route   PATCH /api/admin/users/:id/assign-godown
 * @access  Private (Admin)
 */
export const assignUserGodown = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { godownId } = req.body; // null to remove assignment

        const user = await User.findByPk(id, { attributes: SAFE_ATTRIBUTES });
        if (!user) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Party not found.');

        await user.update({ godownId: godownId || null });

        return sendSuccessResponse(res, HTTP_STATUS.OK, godownId ? 'Party assigned to godown.' : 'Party godown assignment removed.', {
            id: user.id,
            fullname: user.fullname,
            godownId: user.godownId,
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Adjust party balance manually (Jama / Baki)
 * @route   POST /api/admin/users/:id/balance-adjustment
 * @access  Private (Admin)
 */
export const adjustPartyBalance = async (req, res, next) => {
    const t = await User.sequelize.transaction();
    try {
        const { id } = req.params;
        const { amount, type, note, orderId } = req.body; // type: 'JAMA' (+ credit) | 'BAKI' (- debit)

        const numAmount = Math.abs(parseFloat(amount) || 0);
        if (!numAmount || numAmount <= 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please enter a valid amount greater than 0.');
        }

        if (type !== 'JAMA' && type !== 'BAKI') {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Type must be JAMA or BAKI.');
        }

        const user = await User.findByPk(id, { transaction: t });
        if (!user) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Party not found.');
        }

        const prevBalance = parseFloat(user.walletBalance || 0);
        const changeDelta = type === 'JAMA' ? numAmount : -numAmount;
        const newBal = prevBalance + changeDelta;

        await user.update({ walletBalance: newBal }, { transaction: t });

        const adminName = req.user ? (req.user.name || req.user.fullname || 'Admin') : 'Admin';
        const adminId = req.user ? req.user.id : null;

        const logEntry = await PartyBalanceLog.create({
            userId: user.id,
            orderId: orderId || null,
            type,
            amount: numAmount,
            previousBalance: prevBalance,
            newBalance: newBal,
            note: note || (type === 'JAMA' ? `Manual Jama (+₹${numAmount})` : `Manual Baki (-₹${numAmount})`),
            createdById: adminId,
            createdByName: adminName
        }, { transaction: t });

        await t.commit();

        logActivity(req, {
            module: 'Party Management',
            action: 'UPDATE',
            description: `Adjusted balance for "${user.fullname}": ${type} ₹${numAmount}. New Balance: ${newBal >= 0 ? 'Jama' : 'Baki'} ₹${Math.abs(newBal)}`,
            metadata: { userId: user.id, type, amount: numAmount, newBalance: newBal }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, `Party balance updated (${type} ₹${numAmount}).`, {
            user: {
                id: user.id,
                fullname: user.fullname,
                walletBalance: newBal
            },
            log: logEntry
        });
    } catch (error) {
        if (t) await t.rollback();
        next(error);
    }
};

/**
 * @desc    Get party balance transaction history
 * @route   GET /api/admin/users/:id/balance-logs
 * @access  Private (Admin)
 */
export const getPartyBalanceLogs = async (req, res, next) => {
    try {
        const { id } = req.params;
        const logs = await PartyBalanceLog.findAll({
            where: { userId: id },
            order: [['createdAt', 'DESC']],
            limit: 100
        });
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Balance logs fetched.', logs);
    } catch (error) {
        next(error);
    }
};
