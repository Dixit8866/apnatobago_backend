import { Op } from 'sequelize';
import { Order, OrderItem, Product, ProductVariant, User, Volume, OrderAssignment, DeliveryBoy, BusinessProfile, OrderPayment, InventoryStock, SalesReturn, Notification, AppSettings, RouteCategory, BankSetting, Admin, Godown, Cart, ProductPricing, OutletOrder, OutletOrderItem } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { generateOrderInvoice, generateDeliveryLabel, generateDeliveryLabelHTML } from '../../utils/invoiceGenerator.js';
import { sendToDevice } from '../../services/notification.service.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

const getStatusLabel = (status) => {
    switch (status) {
        case 'Pending': return 'Pending (બાકી)';
        case 'Packaging': return 'Packaging (પેકેજિંગ)';
        case 'Packed': return 'Packed (પેક થયેલ)';
        case 'Shipping': return 'Shipping (રવાના કરેલ)';
        case 'Delivered': return 'Delivered (આપેલ)';
        case 'Cancelled':
        case 'Admin Cancel':
        case 'User Cancel':
        case 'Delivery Boy Cancel':
            return 'Cancelled (રદ કરેલ)';
        default: return status;
    }
};
// ... (rest of imports)

const adjustOrderPayments = (order) => {
    if (!order) return order;

    const rowData = order.toJSON ? order.toJSON() : order;
    if (!rowData.payments || rowData.payments.length === 0) {
        const fullTotal = parseFloat(rowData.totalAmount || 0);
        const couponDisc = parseFloat(rowData.couponDiscount || 0);
        const actualPaid = parseFloat(rowData.paidAmount || 0);
        const payableAmt = Math.max(0, fullTotal - couponDisc);
        const currentDue = Math.max(0, payableAmt - actualPaid);
        rowData.payableAmount = payableAmt.toFixed(2);
        rowData.dueAmount = currentDue.toFixed(2);
        if (currentDue <= 1e-7) {
            rowData.paymentStatus = 'Paid';
        }
        return rowData;
    }

    let payments = rowData.payments.map(p => p.toJSON ? p.toJSON() : { ...p });

    const totalCredit = payments.filter(p => p.paymentMethod === 'CREDIT').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const totalReal = payments.filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
    const orderTotal = parseFloat(rowData.totalAmount || 0);

    const nonCreditPortion = Math.max(0, orderTotal - totalCredit);
    const realPaidToCredit = Math.max(0, totalReal - nonCreditPortion);
    const outstandingCredit = Math.max(0, totalCredit - realPaidToCredit);

    let remainingCreditToDistribute = outstandingCredit;

    const adjustedPayments = payments.map(payment => {
        if (payment.paymentMethod === 'CREDIT') {
            const currentAmount = parseFloat(payment.amount || 0);
            const allowedAmount = Math.min(currentAmount, remainingCreditToDistribute);
            remainingCreditToDistribute -= allowedAmount;
            return {
                ...payment,
                amount: allowedAmount.toFixed(2)
            };
        }
        return payment;
    }).filter(p => parseFloat(p.amount) > 0);

    rowData.payments = adjustedPayments;

    const fullTotal = parseFloat(rowData.totalAmount || 0);
    const couponDisc = parseFloat(rowData.couponDiscount || 0);
    const couponPts = Number(rowData.couponPoints || 0);
    const actualPaid = parseFloat(rowData.paidAmount || 0);
    const payableAmt = Math.max(0, fullTotal - couponDisc);
    const currentDue = Math.max(0, payableAmt - actualPaid);

    rowData.couponPoints = couponPts;
    rowData.couponDiscount = couponDisc.toFixed(2);
    rowData.discountType = (couponPts > 0 || couponDisc > 0) ? (rowData.discountType || 'Coupon Discount') : null;
    rowData.payableAmount = payableAmt.toFixed(2);
    rowData.paidAmount = actualPaid.toFixed(2);
    rowData.dueAmount = currentDue.toFixed(2);

    if (currentDue <= 1e-7) {
        rowData.paymentStatus = 'Paid';
    }

    return rowData;
};

/**
 * @desc    Generate Delivery Label PDF
 * @route   GET /api/admin/orders/:id/delivery-label
 * @access  Private (Admin)
 */
export const downloadDeliveryLabel = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'user' },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy' }]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // Return HTML if requested
        if (req.query.format === 'html') {
            const html = generateDeliveryLabelHTML(order);
            res.setHeader('Content-Type', 'text/html');
            return res.send(html);
        }

        const pdfBuffer = await generateDeliveryLabel(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename=Label-${order.orderId}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error(`[Admin Label Generation Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};


/**
 * @desc    Get all orders for admin
 * @route   GET /api/admin/orders
 * @access  Private (Admin)
 */
export const getAllOrders = async (req, res) => {
    try {
        const { status, date, search, deliveryBoyId, startDate, endDate, userId, routeCategoryId, deliveryTiming, godownId } = req.query;
        const baseWhere = {};
        let searchClause = null;
        let dateClause = null;
        let routeClause = null;
        let timingClause = null;

        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            baseWhere.godownId = godownId;
        }

        // Pre-fetch settings to resolve any empty deliveryRoundTiming
        const appSettings = await AppSettings.findOne();
        const rawSchedules = appSettings && Array.isArray(appSettings.deliveryRoundSchedules) ? appSettings.deliveryRoundSchedules : [];
        const normalizedSchedules = rawSchedules.map((round, index) => ({
            id: round.id || `round_${index + 1}`,
            ...round
        }));

        if (userId) {
            baseWhere.userId = userId;
        }

        if (search && String(search).trim() !== '') {
            const term = String(search).trim();
            const searchPattern = `%${term}%`;
            const escapedSearch = sequelize.escape(searchPattern);
            
            searchClause = sequelize.literal(`(
                CAST("Order"."orderId" AS TEXT) ILIKE ${escapedSearch}
                OR COALESCE("Order"."customerName", '') ILIKE ${escapedSearch}
                OR COALESCE("Order"."customerNumber", '') ILIKE ${escapedSearch}
                OR COALESCE("user"."fullname", '') ILIKE ${escapedSearch}
                OR COALESCE("user"."number", '') ILIKE ${escapedSearch}
                OR COALESCE("user"."city", '') ILIKE ${escapedSearch}
                OR COALESCE("user->businessProfile"."shopName", '') ILIKE ${escapedSearch}
                OR COALESCE("user->businessProfile"."shopNameAlt", '') ILIKE ${escapedSearch}
                OR COALESCE("assignment->deliveryBoy"."name", '') ILIKE ${escapedSearch}
                OR COALESCE("assignment->deliveryBoy"."phone", '') ILIKE ${escapedSearch}
            )`);
        }

        // Helper to get today's 24-hour date range in India Standard Time (IST)
        const getISTTodayRange = () => {
            const now = new Date();
            // Offset to IST (+5.5 hours)
            const istTime = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

            const startOfIstToday = new Date(istTime);
            startOfIstToday.setUTCHours(0, 0, 0, 0);
            const startOfTodayUTC = new Date(startOfIstToday.getTime() - (5.5 * 60 * 60 * 1000));

            const endOfIstToday = new Date(istTime);
            endOfIstToday.setUTCHours(23, 59, 59, 999);
            const endOfTodayUTC = new Date(endOfIstToday.getTime() - (5.5 * 60 * 60 * 1000));

            return { startOfTodayUTC, endOfTodayUTC };
        };

        const { startOfTodayUTC, endOfTodayUTC } = getISTTodayRange();
        const isDeliveredType = ['Delivered', 'Payment Collect', 'Payment Verify'].includes(status);
        const dateFilterField = isDeliveredType ? 'deliveredAt' : (status === 'Cancelled' ? 'updatedAt' : (req.query.dateType || 'createdAt'));

        // Apply status filter
        if (status && status !== 'All') {
            if (isDeliveredType) {
                if (status === 'Delivered') {
                    baseWhere.orderStatus = { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] };
                } else if (status === 'Payment Collect') {
                    baseWhere.orderStatus = { [Op.in]: ['Delivered', 'Payment Collect'] };
                    baseWhere.paymentCollectStatus = { [Op.ne]: 'Verified' };
                } else {
                    baseWhere.orderStatus = status;
                }
                // Restrict Delivered/Payment Collect/Payment Verify to today by default unless filtered
                if (!startDate && !endDate && !date) {
                    dateClause = {
                        [Op.or]: [
                            { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                            { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
                        ]
                    };
                }
            } else if (status === 'Cancelled') {
                baseWhere.orderStatus = { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
                // Restrict Cancelled orders to today by default unless filtered
                if (!startDate && !endDate && !date) {
                    dateClause = { updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } };
                }
            } else if (status === 'Pending Due Order') {
                baseWhere.paymentStatus = { [Op.ne]: 'Paid' };
                baseWhere.orderStatus = { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
            } else {
                baseWhere.orderStatus = status;
            }
        }

        // Apply date / date range filters (in IST timezone +05:30)
        const parseISTDate = (dateStr, isEnd = false) => {
            if (!dateStr) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return new Date(`${dateStr}T${isEnd ? '23:59:59.999' : '00:00:00.000'}+05:30`);
            }
            const d = new Date(dateStr);
            if (isEnd) d.setHours(23, 59, 59, 999);
            else d.setHours(0, 0, 0, 0);
            return d;
        };

        let startOfDate = null;
        let endOfDate = null;

        if (startDate && endDate) {
            startOfDate = parseISTDate(startDate, false);
            endOfDate = parseISTDate(endDate, true);
        } else if (startDate) {
            startOfDate = parseISTDate(startDate, false);
            endOfDate = parseISTDate(startDate, true);
        } else if (date) {
            startOfDate = parseISTDate(date, false);
            endOfDate = parseISTDate(date, true);
        }

        if (startOfDate && endOfDate) {
            if (dateFilterField === 'deliveredAt') {
                dateClause = {
                    [Op.or]: [
                        { deliveredAt: { [Op.between]: [startOfDate, endOfDate] } },
                        { deliveredAt: null, updatedAt: { [Op.between]: [startOfDate, endOfDate] } }
                    ]
                };
            } else {
                dateClause = { [dateFilterField]: { [Op.between]: [startOfDate, endOfDate] } };
            }
        }

        // Apply delivery boy filter
        if (deliveryBoyId) {
            baseWhere['$assignment.deliveryBoyId$'] = deliveryBoyId;
        }

        // Apply route category filter
        if (routeCategoryId) {
            if (typeof routeCategoryId === 'string' && routeCategoryId.includes(',')) {
                routeClause = { routeCategoryId: { [Op.in]: routeCategoryId.split(',') } };
            } else {
                routeClause = { routeCategoryId };
            }
        }

        // Apply delivery timing filter (Express or a specific Round timing slot)
        if (deliveryTiming) {
            if (deliveryTiming === 'Express') {
                timingClause = { deliveryMode: 'Express' };
            } else {
                // Find all round IDs that match this timing label in settings
                const matchingRoundIds = normalizedSchedules
                    .filter(r => (r.time || `${r.start || ''} - ${r.end || ''}`) === deliveryTiming)
                    .map(r => r.id);

                if (matchingRoundIds.length > 0) {
                    timingClause = {
                        deliveryMode: 'Round',
                        [Op.or]: [
                            { deliveryRoundTiming: deliveryTiming },
                            { deliveryRoundId: { [Op.in]: matchingRoundIds } }
                        ]
                    };
                } else {
                    timingClause = {
                        deliveryMode: 'Round',
                        deliveryRoundTiming: deliveryTiming
                    };
                }
            }
        }

        const buildWhereClause = ({ includeRoute, includeTiming }) => {
            const clause = { ...baseWhere };
            const andClauses = [];

            if (dateClause) {
                if (dateClause[Op.or]) {
                    andClauses.push({ [Op.or]: dateClause[Op.or] });
                } else {
                    Object.assign(clause, dateClause);
                }
            }

            if (searchClause) {
                andClauses.push(searchClause);
            }

            if (includeRoute && routeClause) {
                Object.assign(clause, routeClause);
            }

            if (includeTiming && timingClause) {
                if (timingClause[Op.or]) {
                    const { [Op.or]: timingOr, ...timingRest } = timingClause;
                    Object.assign(clause, timingRest);
                    andClauses.push({ [Op.or]: timingOr });
                } else {
                    Object.assign(clause, timingClause);
                }
            }

            if (andClauses.length > 0) {
                clause[Op.and] = andClauses;
            }

            return clause;
        };

        const where = buildWhereClause({ includeRoute: true, includeTiming: true });

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Order.findAndCountAll({
            where,
            include: [
                {
                    model: User,
                    as: 'user',
                    required: false,
                    attributes: ['id', 'fullname', 'number', 'city', 'walletBalance'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            required: false,
                            attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    required: false,
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', required: false, attributes: ['id', 'name', 'phone'] }]
                },
                {
                    model: Admin,
                    as: 'creator',
                    required: false,
                    attributes: ['id', 'name', 'role']
                },
                {
                    model: Godown,
                    as: 'godown',
                    required: false,
                    attributes: ['id', 'name']
                },
                {
                    model: Admin,
                    as: 'verifiedByAdmin',
                    required: false,
                    attributes: ['id', 'name']
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        // Fetch and attach one-to-many associations (items and payments) for the paginated subset of orders
        if (result.rows.length > 0) {
            const orderIds = result.rows.map(o => o.id);

            // Fetch OrderItems with nested product, variant, and volumes
            const items = await OrderItem.findAll({
                where: { orderId: orderIds },
                include: [
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'],
                        include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                    },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'extra', 'baseUnitsPerPack', 'sellingVolume'],
                        include: [
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name', 'icon'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name', 'icon'] },
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name', 'icon'] }
                        ]
                    }
                ]
            });

            // Fetch OrderPayments
            const payments = await OrderPayment.findAll({
                where: { orderId: orderIds },
                attributes: ['id', 'amount', 'paymentMethod', 'isSubmitted', 'submittedAt', 'orderId']
            });

            // Fetch SalesReturns
            const returns = await SalesReturn.findAll({
                where: { orderId: orderIds },
                include: [
                    {
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'],
                        include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                    },
                    { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'extra', 'baseUnitsPerPack', 'sellingVolume'] }
                ]
            });

            // Group items, payments, and returns by orderId
            const itemsMap = {};
            items.forEach(item => {
                const oId = item.orderId;
                if (!itemsMap[oId]) itemsMap[oId] = [];
                itemsMap[oId].push(item);
            });

            const paymentsMap = {};
            payments.forEach(p => {
                const oId = p.orderId;
                if (!paymentsMap[oId]) paymentsMap[oId] = [];
                paymentsMap[oId].push(p);
            });

            const returnsMap = {};
            returns.forEach(r => {
                const oId = r.orderId;
                if (!returnsMap[oId]) returnsMap[oId] = [];
                returnsMap[oId].push(r);
            });

            // Attach to Sequelize models using setDataValue so they are serialized correctly
            result.rows = result.rows.map(order => {
                if (order.deliveryMode === 'Round' && order.deliveryRoundId && !order.deliveryRoundTiming) {
                    const matchedRound = normalizedSchedules.find(r => r.id === order.deliveryRoundId);
                    if (matchedRound) {
                        order.setDataValue('deliveryRoundTiming', matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`);
                    }
                }
                order.setDataValue('items', itemsMap[order.id] || []);
                order.setDataValue('payments', paymentsMap[order.id] || []);
                order.setDataValue('returns', returnsMap[order.id] || []);
                return adjustOrderPayments(order);
            });
        }

        // ── Calculate Dynamic Status Counts for Tab Badges ────────────────────────
        const searchIncludes = [
            {
                model: User,
                as: 'user',
                required: false,
                attributes: ['id', 'fullname', 'number', 'city'],
                include: [
                    {
                        model: BusinessProfile,
                        as: 'businessProfile',
                        required: false,
                        attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
                    }
                ]
            },
            {
                model: OrderAssignment,
                as: 'assignment',
                required: false,
                include: [{ model: DeliveryBoy, as: 'deliveryBoy', required: false, attributes: ['id', 'name', 'phone'] }]
            }
        ];

        const countWhere = {};
        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            countWhere.godownId = godownId;
        }
        const countInclude = search ? searchIncludes : [];

        if (routeCategoryId) {
            if (typeof routeCategoryId === 'string' && routeCategoryId.includes(',')) {
                countWhere.routeCategoryId = { [Op.in]: routeCategoryId.split(',') };
            } else {
                countWhere.routeCategoryId = routeCategoryId;
            }
        }

        if (deliveryBoyId) {
            countWhere['$assignment.deliveryBoyId$'] = deliveryBoyId;
            if (!search) {
                countInclude.push({
                    model: OrderAssignment,
                    as: 'assignment'
                });
            }
        }

        let countDateRange = null;
        if (startOfDate && endOfDate) {
            countDateRange = { [Op.between]: [startOfDate, endOfDate] };
        }

        // Setup count filters
        const isDateFiltered = !!(startDate || endDate || date);
        const pendingCountWhere = { ...countWhere, orderStatus: 'Pending' };
        const packagingCountWhere = { ...countWhere, orderStatus: 'Packaging' };
        const packedCountWhere = { ...countWhere, orderStatus: 'Packed' };
        const shippingCountWhere = { ...countWhere, orderStatus: 'Shipping' };

        const deliveredCountWhere = { ...countWhere, orderStatus: { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] } };
        const paymentCollectCountWhere = { 
            ...countWhere, 
            orderStatus: { [Op.in]: ['Delivered', 'Payment Collect'] },
            paymentCollectStatus: { [Op.ne]: 'Verified' }
        };
        const paymentVerifyCountWhere = { ...countWhere, orderStatus: 'Payment Verify' };
        const cancelledCountWhere = { ...countWhere, orderStatus: { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] } };

        const pendingDueCountWhere = {
            ...countWhere,
            paymentStatus: { [Op.ne]: 'Paid' },
            orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
        };

        if (isDateFiltered && countDateRange) {
            pendingCountWhere.createdAt = countDateRange;
            packagingCountWhere.createdAt = countDateRange;
            packedCountWhere.createdAt = countDateRange;
            shippingCountWhere.createdAt = countDateRange;
            pendingDueCountWhere.createdAt = countDateRange;

            deliveredCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            paymentCollectCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            paymentVerifyCountWhere[Op.or] = [
                { deliveredAt: countDateRange },
                { deliveredAt: null, updatedAt: countDateRange }
            ];
            cancelledCountWhere.updatedAt = countDateRange;
        } else {
            // Restrict Delivered and Cancelled badges to today in IST by default if no active date filter is set
            deliveredCountWhere[Op.or] = [
                { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
            ];
            paymentCollectCountWhere[Op.or] = [
                { deliveredAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } },
                { deliveredAt: null, updatedAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } }
            ];
            cancelledCountWhere.updatedAt = { [Op.between]: [startOfTodayUTC, endOfTodayUTC] };
        }

        const countOptions = (whereObj) => ({
            where: whereObj,
            include: countInclude,
            distinct: true,
            col: 'id'
        });

        const [pendingCount, packagingCount, packedCount, shippingCount, deliveredCount, paymentCollectCount, paymentVerifyCount, cancelledCount, todayCount, salesReturnCount, pendingDueCount, userCartCount] = await Promise.all([
            Order.count(countOptions(pendingCountWhere)),
            Order.count(countOptions(packagingCountWhere)),
            Order.count(countOptions(packedCountWhere)),
            Order.count(countOptions(shippingCountWhere)),
            Order.count(countOptions(deliveredCountWhere)),
            Order.count(countOptions(paymentCollectCountWhere)),
            Order.count(countOptions(paymentVerifyCountWhere)),
            Order.count(countOptions(cancelledCountWhere)),
            Order.count(countOptions({ ...countWhere, createdAt: { [Op.between]: [startOfTodayUTC, endOfTodayUTC] } })),
            SalesReturn.count({ where: deliveryBoyId ? { deliveryBoyId } : {} }),
            Order.count(countOptions(pendingDueCountWhere)),
            Cart.count({ distinct: true, col: 'userId' })
        ]);

        // Calculate dynamic order counts by routeCategory for the currently active tab status and date filter
        const routeCountWhere = buildWhereClause({ includeRoute: false, includeTiming: true });
        routeCountWhere['$Order.routeCategoryId$'] = { [Op.ne]: null };

        const routeCountInclude = search ? searchIncludes : (deliveryBoyId ? [{ model: OrderAssignment, as: 'assignment' }] : []);

        const routeCountsRaw = await Order.count({
            where: routeCountWhere,
            include: routeCountInclude,
            group: [sequelize.col('Order.routeCategoryId')],
            distinct: true,
            col: 'id'
        });

        const routeCounts = {};
        if (Array.isArray(routeCountsRaw)) {
            routeCountsRaw.forEach(r => {
                const id = r.routeCategoryId || r.dataValues?.routeCategoryId || r['Order.routeCategoryId'];
                if (id) {
                    routeCounts[id] = parseInt(r.count || r.dataValues?.count || 0, 10);
                }
            });
        }

        // Calculate timing counts — distribution of delivery modes/timings for the current status+route+date filter
        // (excluding the timing filter itself, so all slots show their counts)
        const timingBaseWhere = buildWhereClause({ includeRoute: true, includeTiming: false });

        const timingCountsInclude = search ? searchIncludes : (deliveryBoyId ? [{ model: OrderAssignment, as: 'assignment' }] : []);

        const [expressTimingCount, roundTimingCountsRaw] = await Promise.all([
            Order.count({
                where: { ...timingBaseWhere, deliveryMode: 'Express' },
                include: timingCountsInclude,
                distinct: true,
                col: 'id',
                subQuery: false
            }),
            Order.count({
                where: { ...timingBaseWhere, deliveryMode: 'Round' },
                include: timingCountsInclude,
                group: [sequelize.col('Order.deliveryRoundId'), sequelize.col('Order.deliveryRoundTiming')],
                distinct: true,
                col: 'id',
                subQuery: false
            })
        ]);

        const timingCounts = {};
        if (expressTimingCount > 0) {
            timingCounts['Express'] = expressTimingCount;
        }
        if (Array.isArray(roundTimingCountsRaw)) {
            roundTimingCountsRaw.forEach(r => {
                const roundId = r.deliveryRoundId;
                let timing = r.deliveryRoundTiming;
                
                // Always resolve and normalize timing from normalizedSchedules if roundId is present
                if (roundId) {
                    const matchedRound = normalizedSchedules.find(s => s.id === roundId);
                    if (matchedRound) {
                        timing = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                    }
                }
                
                if (timing) {
                    timingCounts[timing] = (timingCounts[timing] || 0) + parseInt(r.count || 0, 10);
                }
            });
        }

        // Normalize deliveryRoundTiming in the fetched orders list before returning
        if (result && Array.isArray(result.rows)) {
            result.rows.forEach(order => {
                if (order.deliveryRoundId) {
                    const matchedRound = normalizedSchedules.find(s => s.id === order.deliveryRoundId);
                    if (matchedRound) {
                        order.deliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                    }
                }
            });
        }

        const responseData = formatPaginatedResponse(result, page, limit);
        responseData.routeCounts = routeCounts;
        responseData.timingCounts = timingCounts;
        responseData.allRoundTimings = normalizedSchedules.map(r => r.time || `${r.start || ''} - ${r.end || ''}`).filter(Boolean);
        responseData.showExpress = appSettings ? !!appSettings.showExpressDelivery : false;

        // Attach counts to response
        responseData.statusCounts = {
            '': responseData.totalRecords,
            Today: todayCount,
            UserCart: userCartCount,
            Pending: pendingCount,
            Packaging: packagingCount,
            Packed: packedCount,
            Shipping: shippingCount,
            Delivered: deliveredCount,
            'Payment Collect': paymentCollectCount,
            'Payment Verify': paymentVerifyCount,
            Cancelled: cancelledCount,
            SalesReturn: salesReturnCount,
            'Pending Due Order': pendingDueCount
        };

        let paymentTotals = {
            totalAmountSum: 0,
            totalPaidSum: 0,
            totalDueSum: 0,
            cashPaidSum: 0,
            onlinePaidSum: 0
        };

        try {
            const allMatchedOrders = await Order.findAll({
                where,
                include: search ? searchIncludes : (deliveryBoyId ? [{ model: OrderAssignment, as: 'assignment' }] : []),
                attributes: ['id', 'totalAmount', 'paidAmount', 'dueAmount', 'paymentMethod', 'paymentStatus', 'orderStatus']
            });

            allMatchedOrders.forEach(o => {
                const bill = Number(o.totalAmount || 0);
                const paid = Number(o.paidAmount || 0);
                const due = Number(o.dueAmount || 0);
                const pm = String(o.paymentMethod || '').toLowerCase();

                paymentTotals.totalAmountSum += bill;
                paymentTotals.totalPaidSum += paid;
                paymentTotals.totalDueSum += due;

                if (pm.includes('cash') || pm.includes('રોકડ')) {
                    paymentTotals.cashPaidSum += paid > 0 ? paid : (o.paymentStatus === 'Paid' ? bill : 0);
                } else if (pm.includes('online') || pm.includes('upi') || pm.includes('bank') || pm.includes('qr') || pm.includes('gpay') || pm.includes('paytm') || pm.includes('cheque')) {
                    paymentTotals.onlinePaidSum += paid > 0 ? paid : (o.paymentStatus === 'Paid' ? bill : 0);
                } else {
                    if (paid > 0) paymentTotals.cashPaidSum += paid;
                }
            });

            paymentTotals.totalAmountSum = Math.round(paymentTotals.totalAmountSum * 100) / 100;
            paymentTotals.totalPaidSum = Math.round(paymentTotals.totalPaidSum * 100) / 100;
            paymentTotals.totalDueSum = Math.round(paymentTotals.totalDueSum * 100) / 100;
            paymentTotals.cashPaidSum = Math.round(paymentTotals.cashPaidSum * 100) / 100;
            paymentTotals.onlinePaidSum = Math.round(paymentTotals.onlinePaidSum * 100) / 100;
        } catch (err) {
            logger.error(`[getAllOrders paymentTotals calculation error]: ${err.message}`);
        }

        responseData.paymentTotals = paymentTotals;

        if (responseData.orders) {
            responseData.orders = responseData.orders.map(order => adjustOrderPayments(order));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "All orders fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Admin Get Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update order status
 * @route   PUT /api/admin/orders/:id/status
 * @access  Private (Admin)
 */
export const updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderStatus, paymentStatus, paidAmount: newPaidAmount, notes, cashAmount, onlineAmount, creditAmount, paymentNotes } = req.body;

        const order = await Order.findByPk(id);

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const prevStatus = order.orderStatus;
        if (orderStatus) {
            const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
            if (!validStatuses.includes(orderStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
            }
            if (orderStatus === 'Cancelled') {
                order.orderStatus = 'Admin Cancel';
                order.deliveredAt = null;
            } else {
                order.orderStatus = orderStatus;
                
                // Track timestamps for fulfillment milestones and clear downstream steps on reversion
                if (orderStatus === 'Pending') {
                    order.packagingAt = null;
                    order.packedAt = null;
                    order.shippingAt = null;
                    order.deliveredAt = null;
                } else if (orderStatus === 'Packaging') {
                    order.packagingAt = order.packagingAt || new Date();
                    order.packedAt = null;
                    order.shippingAt = null;
                    order.deliveredAt = null;
                } else if (orderStatus === 'Packed') {
                    order.packagingAt = order.packagingAt || new Date();
                    order.packedAt = order.packedAt || new Date();
                    order.shippingAt = null;
                    order.deliveredAt = null;
                } else if (orderStatus === 'Shipping') {
                    order.packagingAt = order.packagingAt || new Date();
                    order.packedAt = order.packedAt || new Date();
                    order.shippingAt = order.shippingAt || new Date();
                    order.deliveredAt = null;
                } else if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) {
                    order.packagingAt = order.packagingAt || new Date();
                    order.packedAt = order.packedAt || new Date();
                    order.shippingAt = order.shippingAt || new Date();
                    order.deliveredAt = order.deliveredAt || new Date();
                }
            }

            if (notes) {
                const timestamp = new Date().toLocaleString();
                const prefix = (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') ? `[Cancelled on ${timestamp}] Reason: ` : `[Status ${orderStatus} on ${timestamp}]: `;
                order.notes = order.notes ? `${order.notes}\n${prefix}${notes}` : `${prefix}${notes}`;
            }

            // If moving to verified status, auto-submit any pending payments
            if (orderStatus === 'Payment Verify' || orderStatus === 'Delivered') {
                await OrderPayment.update(
                    { isSubmitted: true, submittedAt: new Date() },
                    { where: { orderId: order.id, isSubmitted: false } }
                );
            }

            // If cancelled, also cancel associated assignment if exists
            if (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') {
                const OrderAssignment = order.sequelize.models.OrderAssignment;
                if (OrderAssignment) {
                    await OrderAssignment.update(
                        { status: 'Cancelled', notes: notes || 'Cancelled by Admin' },
                        { where: { orderId: order.id } }
                    );
                }

                // If the order was already shipped, convert cancel into SalesReturn entries (Pending)
                // and DO NOT restore inventory until admin approves the sales return.
                if (prevStatus === 'Shipping') {
                    // Create sales return entries for all order items and remove them
                    const assignment = await OrderAssignment.findOne({ where: { orderId: order.id } });
                    const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;
                    let totalReturnAmount = 0;

                    const orderItemsToProcess = await OrderItem.findAll({ where: { orderId: order.id } });
                    for (const item of orderItemsToProcess) {
                        const returnQty = Number(item.quantity);
                        const returnAmount = Number(item.price) * returnQty;

                        await SalesReturn.create({
                            orderId: order.id,
                            userId: order.userId,
                            deliveryBoyId,
                            productId: item.productId,
                            variantId: item.variantId,
                            volumeId: item.volumeId || null,
                            quantity: returnQty,
                            price: item.price,
                            returnAmount,
                            reason: 'Cancelled after shipping (Admin)',
                            status: 'Pending'
                        });

                        totalReturnAmount += returnAmount;
                        await item.destroy();
                    }

                    // Recalculate order totals
                    const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                    let newSubtotal = 0;
                    for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                    order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                    order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                    await order.save();
                } else {
                    // Restore inventory stock for all order items (existing behaviour)
                    const orderItemsToRestore = await OrderItem.findAll({ where: { orderId: order.id } });
                    for (const item of orderItemsToRestore) {
                        const variant = await ProductVariant.findByPk(item.variantId);
                        const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                        const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * sellingVolume * bUPP;

                        logger.info(`[Admin Cancel Restore]: orderId=${order.id}, productId=${item.productId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

                        const stock = await InventoryStock.findOne({
                            where: { productId: item.productId },
                            order: [['createdAt', 'DESC']]
                        });
                        if (stock) {
                            await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore });
                        }
                    }
                }
            }
        }

        // Handle Payment Updates & Cash/Online/Credit Breakdown Entries
        const { isDirectPaymentEdit, returnAmount, discountAmount } = req.body;
        const cash = parseFloat(cashAmount || 0);
        const online = parseFloat(onlineAmount || 0);
        const credit = parseFloat(creditAmount || 0);
        const retDeduction = parseFloat(returnAmount || discountAmount || 0);

        if (isDirectPaymentEdit) {
            // Direct payment update from Order Details page
            await OrderPayment.destroy({ where: { orderId: order.id } });

            if (cash > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: cash,
                    paymentMethod: 'CASH',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Updated Cash Payment'
                });
            }
            if (online > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: online,
                    paymentMethod: 'ONLINE',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Updated Online Payment'
                });
            }
            if (retDeduction > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: retDeduction,
                    paymentMethod: 'RETURN',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Sales Return / Item Exchange Deduction'
                });
            }
            if (credit > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: credit,
                    paymentMethod: 'CREDIT',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Updated Credit Payment'
                });
            }

            if (retDeduction > 0) {
                order.discount = retDeduction.toFixed(2);
            }

            const total = parseFloat(order.totalAmount || 0);
            const netTotal = Math.max(0, total - retDeduction);
            const newPaid = Math.min(netTotal, cash + online);
            order.paidAmount = newPaid.toFixed(2);
            const calculatedDue = Math.max(0, netTotal - newPaid - credit);
            order.dueAmount = calculatedDue.toFixed(2);

            if (paymentStatus && ['Pending', 'Paid', 'Partial', 'Failed', 'Refunded'].includes(paymentStatus)) {
                order.paymentStatus = paymentStatus;
            } else {
                if (calculatedDue <= 1e-5) {
                    order.paymentStatus = 'Paid';
                } else if (newPaid > 0) {
                    order.paymentStatus = 'Partial';
                } else {
                    order.paymentStatus = 'Pending';
                }
            }

            if (paymentNotes) {
                const timestamp = new Date().toLocaleString('en-IN');
                const noteMsg = `[Payment Updated on ${timestamp}]: Cash: ₹${cash}, Online: ₹${online}, Return/Deduction: ₹${retDeduction}, Credit: ₹${credit}. Note: ${paymentNotes}`;
                order.notes = order.notes ? `${order.notes}\n${noteMsg}` : noteMsg;
            }
        } else if (cash > 0 || online > 0 || credit > 0) {
            if (cash > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: cash,
                    paymentMethod: 'CASH',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Collected Cash Payment'
                });
            }
            if (online > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: online,
                    paymentMethod: 'ONLINE',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Collected Online Payment'
                });
            }
            if (credit > 0) {
                await OrderPayment.create({
                    orderId: order.id,
                    amount: credit,
                    paymentMethod: 'CREDIT',
                    isSubmitted: true,
                    submittedAt: new Date(),
                    notes: paymentNotes || notes || 'Admin Recorded Credit Payment'
                });
            }

            const currentPaid = parseFloat(order.paidAmount || 0);
            const total = parseFloat(order.totalAmount || 0);
            const addedReal = cash + online;
            const totalReceived = currentPaid + addedReal;
            const newPaid = Math.min(total, totalReceived);

            order.paidAmount = newPaid.toFixed(2);
            const newDue = Math.max(0, total - newPaid - credit);
            order.dueAmount = newDue.toFixed(2);

            if (newDue <= 1e-5) {
                order.paymentStatus = 'Paid';
            } else if (newPaid > 0) {
            }
        } else if (newPaidAmount !== undefined) {
            const total = parseFloat(order.totalAmount);
            const paid = parseFloat(newPaidAmount);

            order.paidAmount = Math.min(total, paid);
            order.dueAmount = Math.max(0, total - paid);

            if (paid >= total) {
                order.paymentStatus = 'Paid';
            } else if (paid > 0) {
                order.paymentStatus = 'Partial';
            } else {
                order.paymentStatus = 'Pending';
            }
        } else if (paymentStatus) {
            const validPaymentStatuses = ['Pending', 'Paid', 'Partial', 'Failed', 'Refunded'];
            if (!validPaymentStatuses.includes(paymentStatus)) {
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid payment status.");
            }
            order.paymentStatus = paymentStatus;

            if (paymentStatus === 'Paid') {
                order.paidAmount = order.totalAmount;
                order.dueAmount = 0;
            } else if (paymentStatus === 'Pending') {
                order.paidAmount = 0;
                order.dueAmount = order.totalAmount;
            }
        }

        if (order.orderStatus === 'Cancelled' || order.orderStatus === 'Admin Cancel' || order.orderStatus === 'User Cancel' || order.orderStatus === 'Delivery Boy Cancel') {
            order.dueAmount = 0;
            if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partial') {
                order.paymentStatus = 'Refunded';
            } else {
                order.paymentStatus = 'Failed';
            }
        }

        await order.save();

        // Trigger Push Notification on status change
        if (orderStatus && orderStatus !== prevStatus) {
            try {
                const user = await User.findByPk(order.userId);
                if (user && user.fcmtoken) {
                    const statusLabel = getStatusLabel(orderStatus);
                    const title = `Order Status: ${statusLabel}`;
                    const body = `Hey ${user.fullname || 'Customer'}, your order #${order.orderId} status has been updated to ${statusLabel}.`;
                    await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                    await Notification.create({
                        title,
                        body,
                        type: 'ORDER',
                        target: String(order.userId),
                        status: 'SENT',
                        clickAction: String(order.id)
                    });
                }
            } catch (pushErr) {
                console.error('[Update Order Status Push Error]:', pushErr);
            }
        }

        logActivity(req, {
            module: 'Order List',
            action: orderStatus !== prevStatus ? 'STATUS_CHANGE' : 'UPDATE',
            description: `Updated Order #${order.orderId} status to "${order.orderStatus}" (Payment: ${order.paymentStatus})`,
            metadata: { orderId: order.id, orderNo: order.orderId, prevStatus, newStatus: order.orderStatus, paymentStatus: order.paymentStatus }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order status updated successfully.", order);
    } catch (error) {
        logger.error(`[Admin Update Order Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk update order status
 * @route   PUT /api/admin/orders/bulk-status
 * @access  Private (Admin)
 */
export const bulkUpdateOrderStatus = async (req, res) => {
    try {
        const { orderIds, orderStatus } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const validStatuses = ['Pending', 'Packaging', 'Packed', 'Shipping', 'Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
        if (!validStatuses.includes(orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid order status.");
        }

        // Update all matching orders
        const ordersToCancel = await Order.findAll({
            where: { id: orderIds },
            include: [{ model: OrderItem, as: 'items' }]
        });

        const targetStatus = orderStatus === 'Cancelled' ? 'Admin Cancel' : orderStatus;
        const updateFields = { orderStatus: targetStatus };
        if (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') {
            updateFields.dueAmount = 0;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Pending') {
            updateFields.packagingAt = null;
            updateFields.packedAt = null;
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Packaging') {
            updateFields.packagingAt = new Date();
            updateFields.packedAt = null;
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Packed') {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = new Date();
            updateFields.shippingAt = null;
            updateFields.deliveredAt = null;
        } else if (orderStatus === 'Shipping') {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = Order.sequelize.literal('COALESCE("packedAt", NOW())');
            updateFields.shippingAt = new Date();
            updateFields.deliveredAt = null;
        } else if (['Delivered', 'Payment Collect', 'Payment Verify'].includes(orderStatus)) {
            updateFields.packagingAt = Order.sequelize.literal('COALESCE("packagingAt", NOW())');
            updateFields.packedAt = Order.sequelize.literal('COALESCE("packedAt", NOW())');
            updateFields.shippingAt = Order.sequelize.literal('COALESCE("shippingAt", NOW())');
            updateFields.deliveredAt = Order.sequelize.literal('COALESCE("deliveredAt", NOW())');
        }

        await Order.update(
            updateFields,
            { where: { id: orderIds } }
        );

        // If cancelling, process each order: for shipped orders create SalesReturn (pending), otherwise restore inventory
        if (orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel') {
            const OrderAssignment = Order.sequelize.models.OrderAssignment;
            for (const cancelOrder of ordersToCancel) {
                // Set paymentStatus and dueAmount correctly for this order
                const orderRecord = await Order.findByPk(cancelOrder.id);
                if (orderRecord) {
                    orderRecord.dueAmount = 0;
                    if (orderRecord.paymentStatus === 'Paid' || orderRecord.paymentStatus === 'Partial') {
                        orderRecord.paymentStatus = 'Refunded';
                    } else {
                        orderRecord.paymentStatus = 'Failed';
                    }
                    await orderRecord.save();
                }

                if (!cancelOrder.items || cancelOrder.items.length === 0) continue;

                if (cancelOrder.orderStatus === 'Shipping') {
                    // Create sales returns and remove items
                    const assignment = OrderAssignment ? await OrderAssignment.findOne({ where: { orderId: cancelOrder.id } }) : null;
                    const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;
                    let totalReturn = 0;
                    for (const item of cancelOrder.items) {
                        const returnQty = Number(item.quantity);
                        const returnAmount = Number(item.price) * returnQty;
                        await SalesReturn.create({
                            orderId: cancelOrder.id,
                            userId: cancelOrder.userId,
                            deliveryBoyId,
                            productId: item.productId,
                            variantId: item.variantId,
                            volumeId: item.volumeId || null,
                            quantity: returnQty,
                            price: item.price,
                            returnAmount,
                            reason: 'Cancelled after shipping (Bulk Admin)',
                            status: 'Pending'
                        });
                        totalReturn += returnAmount;
                        await OrderItem.destroy({ where: { id: item.id } });
                    }

                    // Recalculate order totals
                    const remaining = await OrderItem.findAll({ where: { orderId: cancelOrder.id } });
                    let newSubtotal = 0;
                    for (const it of remaining) newSubtotal += Number(it.price) * Number(it.quantity);
                    const orderRecord = await Order.findByPk(cancelOrder.id);
                    orderRecord.totalAmount = roundTotal(newSubtotal + (Number(orderRecord.deliveryCharge) || 0));
                    orderRecord.dueAmount = Math.max(0, orderRecord.dueAmount - totalReturn);
                    await orderRecord.save();
                } else {
                    for (const item of cancelOrder.items) {
                        const variant = await ProductVariant.findByPk(item.variantId);
                        const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                        const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * sellingVolume * bUPP;

                        logger.info(`[Admin Bulk Cancel Restore]: orderId=${cancelOrder.id}, productId=${item.productId}, qty=${item.quantity}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore}`);

                        const stock = await InventoryStock.findOne({
                            where: { productId: item.productId },
                            order: [['createdAt', 'DESC']]
                        });
                        if (stock) {
                            await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore });
                        }
                    }
                }
            }
        }

        // Trigger Push Notifications for bulk status update
        try {
            const updatedOrders = await Order.findAll({
                where: { id: orderIds },
                include: [{ model: User, as: 'user' }]
            });
            for (const order of updatedOrders) {
                if (order.user && order.user.fcmtoken) {
                    const statusLabel = getStatusLabel(orderStatus);
                    const title = `Order Status: ${statusLabel}`;
                    const body = `Hey ${order.user.fullname || 'Customer'}, your order #${order.orderId} status has been updated to ${statusLabel}.`;
                    await sendToDevice(order.user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                    await Notification.create({
                        title,
                        body,
                        type: 'ORDER',
                        target: String(order.userId),
                        status: 'SENT',
                        clickAction: String(order.id)
                    });
                }
            }
        } catch (pushErr) {
            console.error('[Bulk Update Status Push Error]:', pushErr);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders status updated successfully.");
    } catch (error) {
        logger.error(`[Admin Bulk Update Order Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Bulk verify payments and move to Delivered
 * @route   PUT /api/admin/orders/bulk-verify-payments
 * @access  Private (Admin)
 */
export const bulkVerifyPayments = async (req, res) => {
    try {
        const { orderIds, note } = req.body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide an array of orderIds.");
        }

        const orders = await Order.findAll({ where: { id: orderIds } });

        for (const order of orders) {
            order.orderStatus = 'Payment Verify';
            order.paymentCollectStatus = 'Verified';
            order.verifiedByAdminId = req.admin?.id || req.user?.id || null;
            order.deliveredAt = order.deliveredAt || new Date();

            if (note) {
                const timestamp = new Date().toLocaleString();
                const prefix = `[Payment Verified on ${timestamp}]: `;
                order.notes = order.notes ? `${order.notes}\n${prefix}${note}` : `${prefix}${note}`;
            }

            await order.save();

            // Auto-submit associated unsubmitted payments
            await OrderPayment.update(
                { isSubmitted: true, submittedAt: new Date() },
                { where: { orderId: order.id, isSubmitted: false } }
            );
        }

        logActivity(req, {
            module: 'Payment',
            action: 'UPDATE',
            description: `Verified payments for ${orders.length} order(s)`,
            metadata: { orderIds, count: orders.length, note }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payments verified and orders moved to Delivered successfully.");
    } catch (error) {
        logger.error(`[Admin Bulk Verify Payments Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Comprehensive Payment Verification & Settlement for an Order
 * @route   PUT /api/admin/orders/:id/verify-settlement
 * @access  Private (Admin)
 */
export const verifyAndSettleOrder = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        const { id } = req.params;
        const { 
            cashAmount = 0, 
            onlineAmount = 0, 
            creditAmount = 0, 
            bankAccountId, 
            note, 
            salesReturns = [],
            previousReturnCredit = 0,
            previousReturnOrderId = null,
            previousSalesReturns = [],
            jamaAmount = 0,
            bakiAmount = 0,
            roundOffAmount = 0
        } = req.body;

        const order = await Order.findByPk(id, {
            include: [
                { model: OrderItem, as: 'items' },
                { model: User, as: 'user' }
            ],
            transaction
        });

        if (!order) {
            await transaction.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const parsedCash = parseFloat(cashAmount) || 0;
        const parsedOnline = parseFloat(onlineAmount) || 0;
        const parsedCredit = parseFloat(creditAmount) || 0;
        const parsedPrevReturn = parseFloat(previousReturnCredit) || 0;
        const parsedJama = parseFloat(jamaAmount) || 0;
        const parsedBaki = parseFloat(bakiAmount) || 0;
        let totalReturnDeduction = 0;

        // Process In-Bill Sales Returns
        if (Array.isArray(salesReturns) && salesReturns.length > 0) {
            for (const itemReturn of salesReturns) {
                const retQty = parseInt(itemReturn.quantity, 10);
                const retPrice = parseFloat(itemReturn.price) || 0;
                if (!retQty || retQty <= 0) continue;

                const itemDeduction = retQty * retPrice;
                totalReturnDeduction += itemDeduction;

                const condition = itemReturn.condition === 'DAMAGED' ? 'DAMAGED' : 'GOOD';

                await SalesReturn.create({
                    orderId: order.id,
                    userId: order.userId,
                    productId: itemReturn.productId,
                    variantId: itemReturn.variantId,
                    quantity: retQty,
                    price: retPrice,
                    returnAmount: itemDeduction,
                    condition,
                    status: 'Approved',
                    reason: itemReturn.reason || 'Payment verification in-bill sales return',
                    approvedByAdminId: req.admin?.id || req.user?.id || null
                }, { transaction });

                if (condition === 'GOOD' && itemReturn.variantId) {
                    const variant = await ProductVariant.findByPk(itemReturn.variantId, { transaction });
                    if (variant) {
                        variant.stock = (parseInt(variant.stock, 10) || 0) + retQty;
                        await variant.save({ transaction });
                    }
                }
            }
        }

        // Process Previous Order / Cross-Bill Sales Returns if specified
        if (Array.isArray(previousSalesReturns) && previousSalesReturns.length > 0) {
            const targetPrevOrderId = previousReturnOrderId || order.id;
            for (const prevRet of previousSalesReturns) {
                const pQty = parseInt(prevRet.quantity, 10);
                const pPrice = parseFloat(prevRet.price) || 0;
                if (!pQty || pQty <= 0) continue;

                const pDeduction = pQty * pPrice;
                const pCondition = prevRet.condition === 'DAMAGED' ? 'DAMAGED' : 'GOOD';

                await SalesReturn.create({
                    orderId: targetPrevOrderId,
                    userId: order.userId,
                    productId: prevRet.productId,
                    variantId: prevRet.variantId,
                    quantity: pQty,
                    price: pPrice,
                    returnAmount: pDeduction,
                    condition: pCondition,
                    status: 'Approved',
                    reason: prevRet.reason || `Cross-bill return credit adjusted against Order #${order.orderId}`,
                    approvedByAdminId: req.admin?.id || req.user?.id || null
                }, { transaction });

                if (pCondition === 'GOOD' && prevRet.variantId) {
                    const variant = await ProductVariant.findByPk(prevRet.variantId, { transaction });
                    if (variant) {
                        variant.stock = (parseInt(variant.stock, 10) || 0) + pQty;
                        await variant.save({ transaction });
                    }
                }
            }
        }

        // Update Order Settlement Fields (Bill total stays intact as requested!)
        order.orderStatus = 'Payment Verify';
        order.paymentCollectStatus = 'Verified';
        order.paidAmount = parsedCash + parsedOnline;
        order.dueAmount = parsedCredit + parsedBaki;
        order.paymentStatus = (parsedCredit + parsedBaki) > 0 ? 'Partial' : 'Paid';
        order.verifiedByAdminId = req.admin?.id || req.user?.id || null;
        order.deliveredAt = order.deliveredAt || new Date();

        // If explicit Party Pending Due override provided, update user wallet balance
        if (order.user && req.body.overridePartyDue !== undefined && req.body.overridePartyDue !== '') {
            const parsedDueOverride = parseFloat(req.body.overridePartyDue) || 0;
            // Negative walletBalance represents dues owed by party
            order.user.walletBalance = -parsedDueOverride;
            await order.user.save({ transaction });
        } else if (order.user && parsedJama > 0) {
            order.user.walletBalance = (parseFloat(order.user.walletBalance) || 0) + parsedJama;
            await order.user.save({ transaction });
        }

        const timestamp = new Date().toLocaleString();
        let noteStr = `[Verified & Settled on ${timestamp}] Cash: ₹${parsedCash}, Online: ₹${parsedOnline}, Credit: ₹${parsedCredit}`;
        if (totalReturnDeduction > 0) {
            noteStr += `, In-Bill Return Deduction: ₹${totalReturnDeduction.toFixed(2)}`;
        }
        if (parsedPrevReturn > 0) {
            noteStr += `, Previous Order Return Credit: ₹${parsedPrevReturn.toFixed(2)}`;
        }
        if (parsedJama > 0) {
            noteStr += `, Account Jama (+): ₹${parsedJama.toFixed(2)}`;
        }
        if (parsedBaki > 0) {
            noteStr += `, Account Baki (-): ₹${parsedBaki.toFixed(2)}`;
        }
        if (note) {
            noteStr += `\nNotes: ${note}`;
        }
        order.notes = order.notes ? `${order.notes}\n${noteStr}` : noteStr;

        await order.save({ transaction });

        // Upsert OrderPayment record
        let orderPayment = await OrderPayment.findOne({ where: { orderId: order.id }, transaction });
        if (!orderPayment) {
            orderPayment = new OrderPayment({ orderId: order.id, userId: order.userId });
        }
        orderPayment.cashAmount = parsedCash;
        orderPayment.onlineAmount = parsedOnline;
        orderPayment.creditAmount = parsedCredit;
        orderPayment.paymentMethod = parsedOnline > 0 ? (parsedCash > 0 ? 'MIXED' : 'ONLINE') : (parsedCredit > 0 ? 'CREDIT' : 'CASH');
        
        const isValidUUID = typeof bankAccountId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bankAccountId);
        orderPayment.bankAccountId = isValidUUID ? bankAccountId : null;
        orderPayment.isSubmitted = true;
        orderPayment.submittedAt = new Date();
        await orderPayment.save({ transaction });

        await transaction.commit();

        try {
            logActivity(req, {
                module: 'Payment',
                action: 'UPDATE',
                description: `Verified and settled payment for Order #${order.orderId}`,
                metadata: { orderId: order.id, cashAmount: parsedCash, onlineAmount: parsedOnline, creditAmount: parsedCredit, totalReturnDeduction, parsedPrevReturn }
            });
        } catch (logErr) {
            logger.warn(`Activity log skipped during settlement: ${logErr.message}`);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment verified and settled successfully.", order);
    } catch (error) {
        if (transaction && !transaction.finished) {
            await transaction.rollback();
        }
        logger.error(`[Admin Verify & Settle Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get single order details for admin
 * @route   GET /api/admin/orders/:id
 * @access  Private (Admin)
 */
export const getOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const isUUID = id.includes('-');
        const queryOption = isUUID ? { id } : { orderId: id };

        const order = await Order.findOne({
            where: queryOption,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'dialcode', 'applevel', 'walletBalance'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'],
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'purchasePrice', 'baseUnitsPerPack', 'sellingVolume', 'extra'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name', 'phone', 'vehicleNumber'] }]
                },
                {
                    model: OrderPayment,
                    as: 'payments',
                    attributes: ['id', 'amount', 'paymentMethod', 'isSubmitted', 'submittedAt', 'bankSettingId'],
                    include: [
                        {
                            model: BankSetting,
                            as: 'bankAccount',
                            attributes: ['id', 'bankName', 'accountName', 'accountNumber']
                        }
                    ]
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'extra', 'baseUnitsPerPack', 'sellingVolume'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                },
                {
                    model: Admin,
                    as: 'creator',
                    required: false,
                    attributes: ['id', 'name', 'role']
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // Resolve deliveryRoundTiming dynamically if not set
        if (order.deliveryMode === 'Round' && order.deliveryRoundId && !order.deliveryRoundTiming) {
            const appSettings = await AppSettings.findOne();
            if (appSettings && Array.isArray(appSettings.deliveryRoundSchedules)) {
                const normalizedSchedules = appSettings.deliveryRoundSchedules.map((round, index) => ({
                    id: round.id || `round_${index + 1}`,
                    ...round
                }));
                const matchedRound = normalizedSchedules.find(r => r.id === order.deliveryRoundId);
                if (matchedRound) {
                    order.setDataValue('deliveryRoundTiming', matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`);
                }
            }
        }

        const adjustedOrder = adjustOrderPayments(order);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", adjustedOrder);
    } catch (error) {
        logger.error(`[Admin Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Generate Invoice PDF
 * @route   GET /api/admin/orders/:id/invoice
 * @access  Private (Admin)
 */
export const downloadInvoice = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(id, {
            include: [
                { model: User, as: 'user' },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        { model: ProductVariant, as: 'variant' }
                    ]
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            include: [{ model: ProductVariant, as: 'variants', attributes: ['id'] }]
                        },
                        { model: ProductVariant, as: 'variant' }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const pdfBuffer = await generateOrderInvoice(order);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Invoice-${order.orderId}.pdf`);
        return res.send(pdfBuffer);
    } catch (error) {
        logger.error(`[Admin Invoice Generation Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Update single order item quantity and price
 * @route   PUT /api/admin/orders/:id/items/:itemId
 * @access  Private (Admin)
 */
export const updateOrderItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { quantity, price, sellUnit, variantId } = req.body;

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const orderItem = await OrderItem.findOne({
            where: { id: itemId, orderId: order.id }
        });
        if (!orderItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order item not found.");
        }

        const oldQuantity = parseFloat(orderItem.quantity || 0);
        const oldSellUnit = orderItem.sellUnit;
        const newQuantity = parseFloat(quantity || 0);
        const newSellUnit = sellUnit || oldSellUnit;

        let variant = null;
        if (variantId && variantId !== orderItem.variantId) {
            variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'volumeRef' },
                    { model: Volume, as: 'baseUnitRef' },
                    { model: Volume, as: 'innerUnitRef' }
                ]
            });
            if (!variant) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found.");
            }
        } else {
            variant = await ProductVariant.findByPk(orderItem.variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'volumeRef' },
                    { model: Volume, as: 'baseUnitRef' },
                    { model: Volume, as: 'innerUnitRef' }
                ]
            });
        }

        const oldBUPP = parseFloat(orderItem.variantInfo?.baseUnitsPerPack || 1);
        const newBUPP = variant ? parseFloat(variant.baseUnitsPerPack || 1) : oldBUPP;

        // Calculate old and new base units
        const oldBaseUnits = oldSellUnit === 'Inner' ? oldQuantity : oldQuantity * oldBUPP;
        const newBaseUnits = newSellUnit === 'Inner' ? newQuantity : newQuantity * newBUPP;
        const baseUnitsDiff = newBaseUnits - oldBaseUnits;

        orderItem.quantity = newQuantity;
        orderItem.price = parseFloat(price || 0);
        orderItem.sellUnit = newSellUnit;

        if (variant) {
            if (variant.id !== orderItem.variantId) {
                orderItem.variantId = variant.id;
                orderItem.productId = variant.productId;
            }
            orderItem.variantInfo = {
                productName: variant.product?.name || '',
                volume: variant.volume,
                extra: variant.extra || '',
                extraName: variant.extra || '',
                image: variant.image || variant.product?.thumbnail || '',
                innerUnitLabel: variant.innerUnitRef?.name
                    ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                    : variant.innerUnitLabel,
                baseUnitLabel: variant.baseUnitRef?.name
                    ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                    : variant.baseUnitLabel,
                sellingVolume: variant.sellingVolume,
                baseUnitsPerPack: variant.baseUnitsPerPack
            };
        }

        await orderItem.save();

        // Adjust stock if base units changed
        if (baseUnitsDiff !== 0) {
            const stock = await InventoryStock.findOne({
                where: { productId: orderItem.productId },
                order: [['createdAt', 'DESC']]
            });
            if (stock) {
                await stock.update({ totalBaseUnits: Math.max(0, stock.totalBaseUnits - baseUnitsDiff) });
            }
        }

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);

        if (paidAmount >= newTotalAmount) {
            order.paymentStatus = 'Paid';
        } else if (paidAmount > 0) {
            order.paymentStatus = 'Partial';
        } else {
            order.paymentStatus = 'Pending';
        }

        await order.save();

        // Trigger Push Notification for item update
        try {
            const user = await User.findByPk(order.userId);
            if (user && user.fcmtoken) {
                const title = 'Order Updated!';
                const body = `Hey ${user.fullname || 'Customer'}, items or prices have been updated in your order #${order.orderId}.`;
                await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                await Notification.create({
                    title,
                    body,
                    type: 'ORDER',
                    target: String(order.userId),
                    status: 'SENT',
                    clickAction: String(order.id)
                });
            }
        } catch (pushErr) {
            console.error('[Update Order Item Push Error]:', pushErr);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order item updated successfully.", order);
    } catch (error) {
        logger.error(`[Admin Update Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Add a new item to an existing order
 * @route   POST /api/admin/orders/:id/items
 * @access  Private (Admin)
 */
export const addOrderItem = async (req, res) => {
    try {
        const { id } = req.params;
        const { variantId, quantity, price, sellUnit } = req.body;

        if (!variantId || !quantity || !price) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "variantId, quantity and price are required.");
        }

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const variant = await ProductVariant.findByPk(variantId, {
            include: [
                { model: Product, as: 'product' },
                { model: Volume, as: 'volumeRef' },
                { model: Volume, as: 'baseUnitRef' },
                { model: Volume, as: 'innerUnitRef' }
            ]
        });
        if (!variant) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found.");
        }

        const qty = parseFloat(quantity);
        const unitSell = sellUnit || 'Base';
        const bUPP = parseFloat(variant.baseUnitsPerPack || 1);

        // Build variantInfo snapshot for the order item
        const variantInfo = {
            productName: variant.product?.name || '',
            volume: variant.volume,
            extra: variant.extra || '',
            extraName: variant.extra || '',
            image: variant.image || variant.product?.thumbnail || '',
            innerUnitLabel: variant.innerUnitRef?.name
                ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                : variant.innerUnitLabel,
            baseUnitLabel: variant.baseUnitRef?.name
                ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                : variant.baseUnitLabel,
            sellingVolume: variant.sellingVolume,
            baseUnitsPerPack: variant.baseUnitsPerPack
        };

        // Create the new order item
        const newItem = await OrderItem.create({
            orderId: order.id,
            productId: variant.productId,
            variantId: variant.id,
            quantity: qty,
            price: parseFloat(price),
            sellUnit: unitSell,
            variantInfo
        });

        // Deduct from stock
        const baseUnitsToDeduct = unitSell === 'Inner' ? qty : qty * bUPP;
        const stock = await InventoryStock.findOne({
            where: { productId: variant.productId },
            order: [['createdAt', 'DESC']]
        });
        if (stock) {
            await stock.update({ totalBaseUnits: Math.max(0, stock.totalBaseUnits - baseUnitsToDeduct) });
        }

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);
        if (paidAmount >= newTotalAmount) order.paymentStatus = 'Paid';
        else if (paidAmount > 0) order.paymentStatus = 'Partial';
        else order.paymentStatus = 'Pending';

        await order.save();

        // Trigger Push Notification for item addition
        try {
            const user = await User.findByPk(order.userId);
            if (user && user.fcmtoken) {
                const title = 'Order Updated!';
                const body = `Hey ${user.fullname || 'Customer'}, new items have been added to your order #${order.orderId}.`;
                await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                await Notification.create({
                    title,
                    body,
                    type: 'ORDER',
                    target: String(order.userId),
                    status: 'SENT',
                    clickAction: String(order.id)
                });
            }
        } catch (pushErr) {
            console.error('[Add Order Item Push Error]:', pushErr);
        }

        logger.info(`[Admin Add Order Item]: Added variant ${variantId} to order ${id}`);
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Item added to order successfully.", { item: newItem, order });
    } catch (error) {
        logger.error(`[Admin Add Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delete an item from an existing order (qty set to 0)
 * @route   DELETE /api/admin/orders/:id/items/:itemId
 * @access  Private (Admin)
 */
export const deleteOrderItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;

        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const orderItem = await OrderItem.findOne({ where: { id: itemId, orderId: order.id } });
        if (!orderItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order item not found.");
        }

        const qty = parseFloat(orderItem.quantity || 0);
        const unitSell = orderItem.sellUnit || 'Base';
        const variant = await ProductVariant.findByPk(orderItem.variantId);
        const bUPP = parseFloat(variant?.baseUnitsPerPack || orderItem.variantInfo?.baseUnitsPerPack || 1);

        // Restore stock
        const baseUnitsToRestore = unitSell === 'Inner' ? qty : qty * bUPP;
        const stock = await InventoryStock.findOne({
            where: { productId: orderItem.productId },
            order: [['createdAt', 'DESC']]
        });
        if (stock) {
            await stock.update({ totalBaseUnits: stock.totalBaseUnits + baseUnitsToRestore });
        }

        await orderItem.destroy();

        // Recalculate order totals
        const allItems = await OrderItem.findAll({ where: { orderId: order.id } });
        let calculatedSubtotal = 0;
        for (const item of allItems) {
            calculatedSubtotal += parseFloat(item.price || 0) * parseFloat(item.quantity || 0);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge || 0);
        const newTotalAmount = roundTotal(calculatedSubtotal + deliveryCharge);
        const paidAmount = parseFloat(order.paidAmount || 0);

        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, newTotalAmount - paidAmount);
        if (paidAmount >= newTotalAmount) order.paymentStatus = 'Paid';
        else if (paidAmount > 0) order.paymentStatus = 'Partial';
        else order.paymentStatus = 'Pending';

        await order.save();

        // Trigger Push Notification for item deletion
        try {
            const user = await User.findByPk(order.userId);
            if (user && user.fcmtoken) {
                const title = 'Order Updated!';
                const body = `Hey ${user.fullname || 'Customer'}, an item was removed or updated in your order #${order.orderId}.`;
                await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                await Notification.create({
                    title,
                    body,
                    type: 'ORDER',
                    target: String(order.userId),
                    status: 'SENT',
                    clickAction: String(order.id)
                });
            }
        } catch (pushErr) {
            console.error('[Delete Order Item Push Error]:', pushErr);
        }

        logger.info(`[Admin Delete Order Item]: Removed item ${itemId} from order ${id}`);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Item removed from order successfully.", order);
    } catch (error) {
        logger.error(`[Admin Delete Order Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Merge two orders of the same customer
 * @route   POST /api/admin/orders/merge
 * @access  Private (Admin)
 */
export const mergeOrders = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { sourceOrderId, sourceOrderIds, targetOrderId, targetStatus } = req.body;

        const resolvedSourceOrderIds = sourceOrderIds || (sourceOrderId ? [sourceOrderId] : []);

        if (resolvedSourceOrderIds.length === 0 || !targetOrderId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Source and Target Order IDs are required.");
        }

        if (resolvedSourceOrderIds.includes(targetOrderId)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Cannot merge an order into itself.");
        }

        // Fetch target order
        const targetOrder = await Order.findByPk(targetOrderId, {
            include: [{ model: OrderItem, as: 'items' }],
            transaction: t
        });

        if (!targetOrder) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Target order not found.");
        }

        let combinedNotes = [targetOrder.notes];
        let newPaidAmount = Number(targetOrder.paidAmount || 0);

        // Verify status of target is mergeable (Pending, Packaging, Packed)
        const allowedStatuses = ['Pending', 'Packaging', 'Packed'];
        if (!allowedStatuses.includes(targetOrder.orderStatus)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Target order must be in Pending, Packaging, or Packed status.");
        }

        // Loop through each source order and merge it
        for (const sId of resolvedSourceOrderIds) {
            const sourceOrder = await Order.findByPk(sId, {
                include: [{ model: OrderItem, as: 'items' }],
                transaction: t
            });

            if (!sourceOrder) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Source order ${sId} not found.`);
            }

            // Verify they belong to the same customer
            const sameUser = sourceOrder.userId && targetOrder.userId && sourceOrder.userId === targetOrder.userId;
            const sameGuest = !sourceOrder.userId && !targetOrder.userId && 
                              sourceOrder.customerName === targetOrder.customerName && 
                              sourceOrder.customerNumber === targetOrder.customerNumber;

            if (!sameUser && !sameGuest) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Orders must belong to the same customer to be merged.");
            }

            if (!allowedStatuses.includes(sourceOrder.orderStatus)) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Only orders in Pending, Packaging, or Packed status can be merged.");
            }

            // Merge Items
            for (const sourceItem of sourceOrder.items) {
                const { variantId, quantity, price, sellUnit, productId, variantInfo, discount } = sourceItem;

                // Check if item already exists in target order
                const targetItem = targetOrder.items.find(
                    item => item.variantId === variantId && item.sellUnit === sellUnit
                );

                if (targetItem) {
                    const newQty = Number(targetItem.quantity) + Number(quantity);
                    const newDiscount = Number(targetItem.discount || 0) + Number(discount || 0);
                    
                    // Calculate weighted average price to preserve exact amount
                    const newPrice = ((Number(targetItem.price) * Number(targetItem.quantity)) + 
                                      (Number(price) * Number(quantity))) / newQty;

                    await targetItem.update({
                        quantity: newQty,
                        price: newPrice.toFixed(2),
                        discount: newDiscount.toFixed(2)
                    }, { transaction: t });
                } else {
                    // Change orderId of the source item to target order
                    await sourceItem.update({ orderId: targetOrder.id }, { transaction: t });
                }
            }

            // Combine paid amount and notes
            newPaidAmount += Number(sourceOrder.paidAmount || 0);
            if (sourceOrder.notes) {
                combinedNotes.push(sourceOrder.notes);
            }

            // Delete the source order
            await sourceOrder.destroy({ transaction: t });
        }

        // Recalculate Target Order Totals
        const updatedTargetItems = await OrderItem.findAll({
            where: { orderId: targetOrder.id },
            transaction: t
        });

        let newSubtotal = 0;
        let newTotalDiscount = 0;
        for (const item of updatedTargetItems) {
            newSubtotal += Number(item.price) * Number(item.quantity);
            newTotalDiscount += Number(item.discount || 0) * Number(item.quantity);
        }

        // Fetch settings for delivery charge recalculation
        const settings = await AppSettings.findOne({ transaction: t });
        let newDeliveryCharge = 0;
        
        // Use target order's delivery mode
        const deliveryMode = targetOrder.deliveryMode || 'Outlet';
        
        if (settings && newSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
            if (deliveryMode === 'Express') newDeliveryCharge = parseFloat(settings.expressDeliveryCharge || 0);
            else if (deliveryMode === 'Round') newDeliveryCharge = parseFloat(settings.deliveryOnRoundCharge || 0);
        }

        const newTotalAmount = roundTotal(newSubtotal + newDeliveryCharge);
        const newDueAmount = Math.max(0, newTotalAmount - newPaidAmount);

        // Update target order status to targetStatus if provided, otherwise keep target status
        let mergedStatus = targetOrder.orderStatus;
        if (targetStatus && allowedStatuses.includes(targetStatus)) {
            mergedStatus = targetStatus;
        }

        // Update target order
        await targetOrder.update({
            totalAmount: newTotalAmount,
            paidAmount: newPaidAmount,
            dueAmount: newDueAmount,
            discount: newTotalDiscount,
            deliveryCharge: newDeliveryCharge,
            orderStatus: mergedStatus,
            isMerged: true,
            notes: combinedNotes.filter(Boolean).join('\n')
        }, { transaction: t });

        await t.commit();

        // Trigger Push Notification for order merge
        try {
            const user = await User.findByPk(targetOrder.userId);
            if (user && user.fcmtoken) {
                const title = 'Orders Merged!';
                const body = `Hey ${user.fullname || 'Customer'}, your orders have been merged into order #${targetOrder.orderId}.`;
                await sendToDevice(user.fcmtoken, title, body, null, { type: 'order', id: String(targetOrder.id), orderId: String(targetOrder.id) });
                await Notification.create({
                    title,
                    body,
                    type: 'ORDER',
                    target: String(targetOrder.userId),
                    status: 'SENT',
                    clickAction: String(targetOrder.id)
                });
            }
        } catch (pushErr) {
            console.error('[Merge Orders Push Error]:', pushErr);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, `Orders merged successfully into ${targetOrder.orderId}.`, targetOrder);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Merge Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all other orders for the same customer that can be merged
 * @route   GET /api/admin/orders/:id/mergeable
 * @access  Private (Admin)
 */
export const getMergeableOrders = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await Order.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const where = {
            id: { [Op.ne]: id },
            orderStatus: { [Op.in]: ['Pending', 'Packaging', 'Packed'] }
        };

        if (order.userId) {
            where.userId = order.userId;
        } else {
            where.userId = null;
            where.customerName = order.customerName;
            where.customerNumber = order.customerNumber;
        }

        const mergeableOrders = await Order.findAll({
            where,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber', 'mainCategoryId'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Mergeable orders fetched successfully.", mergeableOrders);
    } catch (error) {
        logger.error(`[Get Mergeable Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get user carts for admin
 * @route   GET /api/admin/orders/user-carts
 * @access  Private (Admin)
 */
export const getUserCarts = async (req, res) => {
    try {
        const { search, godownId, routeCategoryId, page: queryPage, limit: queryLimit } = req.query;
        const page = parseInt(queryPage) || 1;
        const limit = parseInt(queryLimit) || 50;

        const userWhere = {};
        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            userWhere.godownId = godownId;
        }
        if (routeCategoryId) {
            userWhere.routeCategoryId = routeCategoryId;
        }

        if (search) {
            const escapedSearch = sequelize.escape(`%${search}%`);
            userWhere[Op.or] = [
                sequelize.literal(`"user"."fullname" ILIKE ${escapedSearch}`),
                sequelize.literal(`"user"."number" ILIKE ${escapedSearch}`),
                sequelize.literal(`"user"."city" ILIKE ${escapedSearch}`),
                sequelize.literal(`"user->businessProfile"."shopName" ILIKE ${escapedSearch}`),
                sequelize.literal(`"user->businessProfile"."shopAddress" ILIKE ${escapedSearch}`),
                sequelize.literal(`"product"."name" ILIKE ${escapedSearch}`)
            ];
        }

        const cartItems = await Cart.findAll({
            include: [
                {
                    model: User,
                    as: 'user',
                    required: true,
                    where: Object.keys(userWhere).length > 0 ? userWhere : undefined,
                    attributes: ['id', 'fullname', 'number', 'city', 'applevel', 'routeCategoryId', 'godownId'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            required: false,
                            attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                        },
                        {
                            model: RouteCategory,
                            as: 'routeCategory',
                            required: false,
                            attributes: ['id', 'name']
                        },
                        {
                            model: Godown,
                            as: 'assignedGodown',
                            required: false,
                            attributes: ['id', 'name']
                        }
                    ]
                },
                {
                    model: Product,
                    as: 'product',
                    required: true,
                    attributes: ['id', 'name', 'thumbnail', 'boxNumber']
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    required: true,
                    attributes: ['id', 'volume', 'extra', 'image', 'baseUnitLabel', 'innerUnitLabel', 'purchasePrice', 'sellingVolume', 'baseUnitsPerPack'],
                    include: [
                        {
                            model: ProductPricing,
                            as: 'pricings',
                            attributes: ['customLevelId', 'minQty', 'maxQty', 'price', 'mrp']
                        },
                        { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                        { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                    ]
                }
            ],
            order: [['updatedAt', 'DESC']]
        });

        // Group cart items by User
        const userCartsMap = new Map();

        for (const item of cartItems) {
            const user = item.user;
            if (!user) continue;

            const userId = user.id;
            if (!userCartsMap.has(userId)) {
                userCartsMap.set(userId, {
                    id: userId,
                    userId: userId,
                    user: user,
                    items: [],
                    totalItems: 0,
                    totalQty: 0,
                    totalCartAmount: 0,
                    lastUpdated: item.updatedAt
                });
            }

            const group = userCartsMap.get(userId);
            const variant = item.variant;
            const product = item.product;
            const quantity = Number(item.quantity);
            const userAppLevel = user.applevel;

            // Determine unit price based on pricing tier or purchase price
            let applicablePricing = variant?.pricings?.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );
            if (!applicablePricing) {
                applicablePricing = variant?.pricings?.find(p => p.customLevelId === userAppLevel);
            }
            const unitPrice = applicablePricing ? Number(applicablePricing.price) : Number(variant?.purchasePrice || 0);
            const itemTotal = unitPrice * quantity;

            const rawPName = product?.name;
            const productNameStr = typeof rawPName === 'object' && rawPName !== null
                ? (rawPName.gu || rawPName.en || rawPName.HN || Object.values(rawPName)[0] || 'Product')
                : (rawPName || 'Product');

            group.items.push({
                cartId: item.id,
                productId: product?.id,
                variantId: variant?.id,
                productName: productNameStr,
                thumbnail: variant?.image || product?.thumbnail,
                volumeLabel: variant?.volume,
                extra: variant?.extra,
                baseUnitLabel: variant?.baseUnitRef?.name ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel) : variant?.baseUnitLabel,
                innerUnitLabel: variant?.innerUnitRef?.name ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel) : variant?.innerUnitLabel,
                quantity,
                unitPrice: Number(unitPrice.toFixed(2)),
                totalPrice: Number(itemTotal.toFixed(2)),
                updatedAt: item.updatedAt
            });

            group.totalItems += 1;
            group.totalQty += quantity;
            group.totalCartAmount += itemTotal;
            if (new Date(item.updatedAt) > new Date(group.lastUpdated)) {
                group.lastUpdated = item.updatedAt;
            }
        }

        const allUserCarts = Array.from(userCartsMap.values());
        // Sort user carts by most recent update time
        allUserCarts.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

        const totalRecords = allUserCarts.length;
        const totalPages = Math.ceil(totalRecords / limit) || 1;
        const startIndex = (page - 1) * limit;
        const paginatedUserCarts = allUserCarts.slice(startIndex, startIndex + limit);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "User carts fetched successfully.", {
            data: paginatedUserCarts,
            totalRecords,
            currentPage: page,
            totalPages,
            limit
        });
    } catch (error) {
        logger.error(`[Get User Carts Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Delete single cart item by Admin
 * @route   DELETE /api/admin/orders/user-carts/:cartId
 * @access  Private (Admin)
 */
export const deleteUserCartItem = async (req, res) => {
    try {
        const { cartId } = req.params;
        const cartItem = await Cart.findByPk(cartId);
        if (!cartItem) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Cart item not found.");
        }
        await cartItem.destroy();
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Cart item removed successfully.");
    } catch (error) {
        logger.error(`[Delete Cart Item Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Clear entire cart of a user by Admin
 * @route   DELETE /api/admin/orders/user-carts/clear/:userId
 * @access  Private (Admin)
 */
export const clearUserCart = async (req, res) => {
    try {
        const { userId } = req.params;
        await Cart.destroy({ where: { userId } });
        return sendSuccessResponse(res, HTTP_STATUS.OK, "User cart cleared successfully.");
    } catch (error) {
        logger.error(`[Clear User Cart Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get Customer Payments & Stock Reconciliation Report data
 * @route   GET /api/admin/orders/customer-payments-report
 * @access  Private (Admin)
 */
export const getCustomerPaymentsReport = async (req, res) => {
    try {
        const { startDate, endDate, deliveryBoyId, godownId } = req.query;

        const baseWhere = {
            orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
        };

        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            baseWhere.godownId = godownId;
        }

        // Date range handling (IST +05:30)
        const parseISTDate = (dateStr, isEnd = false) => {
            if (!dateStr) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                return new Date(`${dateStr}T${isEnd ? '23:59:59.999' : '00:00:00.000'}+05:30`);
            }
            const d = new Date(dateStr);
            if (isEnd) d.setHours(23, 59, 59, 999);
            else d.setHours(0, 0, 0, 0);
            return d;
        };

        let startOfDate = parseISTDate(startDate, false);
        let endOfDate = parseISTDate(endDate, true);

        if (!startOfDate || !endOfDate) {
            const now = new Date();
            startOfDate = new Date(now.setHours(0, 0, 0, 0));
            endOfDate = new Date(now.setHours(23, 59, 59, 999));
        }

        // Match date on deliveredAt, updatedAt, or createdAt
        baseWhere[Op.or] = [
            { deliveredAt: { [Op.between]: [startOfDate, endOfDate] } },
            { deliveredAt: null, updatedAt: { [Op.between]: [startOfDate, endOfDate] } },
            { createdAt: { [Op.between]: [startOfDate, endOfDate] } }
        ];

        // Delivery Boy filter
        if (deliveryBoyId) {
            baseWhere['$assignment.deliveryBoyId$'] = deliveryBoyId;
        }

        // 1. Fetch Customer Orders
        const orders = await Order.findAll({
            where: baseWhere,
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'purchasePrice', 'baseUnitsPerPack', 'baseUnitLabel', 'innerUnitLabel'],
                            include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'], required: false }]
                        }
                    ]
                },
                {
                    model: OrderAssignment,
                    as: 'assignment',
                    include: [{ model: DeliveryBoy, as: 'deliveryBoy', attributes: ['id', 'name', 'phone'] }]
                },
                {
                    model: OrderPayment,
                    as: 'payments'
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // 2. Fetch Outlet Orders (Direct Counter Orders)
        const outletWhere = {
            orderStatus: { [Op.ne]: 'Cancelled' },
            createdAt: { [Op.between]: [startOfDate, endOfDate] }
        };
        if (godownId && godownId !== 'all' && req.query.all !== 'true' && req.query.allGodowns !== 'true') {
            outletWhere.godownId = godownId;
        }

        let outletOrders = [];
        if (!deliveryBoyId || deliveryBoyId === 'all') {
            try {
                outletOrders = await OutletOrder.findAll({
                    where: outletWhere,
                    include: [
                        {
                            model: OutletOrderItem,
                            as: 'items',
                            include: [
                                { model: Product, as: 'product', attributes: ['id', 'name'] },
                                {
                                    model: ProductVariant,
                                    as: 'variant',
                                    attributes: ['id', 'volume', 'purchasePrice', 'baseUnitsPerPack', 'baseUnitLabel', 'innerUnitLabel'],
                                    include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'], required: false }]
                                }
                            ]
                        }
                    ]
                });
            } catch (e) {
                logger.warn(`[Outlet Orders Fetch Warning]: ${e.message}`);
            }
        }

        let customerCash = 0;
        let customerOnline = 0;
        let outletCash = 0;
        let outletOnline = 0;
        let totalPendingDue = 0;
        const pendingShops = [];
        const collectedShops = [];
        const stockMap = new Map();
        const dbSummaryMap = new Map();

        // Helper for volume display (stripping any raw UUIDs)
        const sanitizeText = (str) => {
            if (!str) return '';
            if (typeof str === 'object') {
                str = str.gu || str.en || Object.values(str)[0] || '';
            }
            const text = String(str).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').trim();
            return text;
        };

        const formatVolumeDisplay = (item) => {
            const vObj = item.variant || item.variantInfo || {};
            let name = '';

            if (vObj.volumeRef && vObj.volumeRef.name) {
                name = sanitizeText(vObj.volumeRef.name);
            }

            if (!name && vObj.volume) {
                name = sanitizeText(vObj.volume);
            }

            if (!name && item.sellVolume) {
                name = sanitizeText(item.sellVolume);
            }

            let unit = sanitizeText(item.sellUnit);
            if (unit === 'Base' || !unit) {
                unit = sanitizeText(vObj.baseUnitLabel) || sanitizeText(vObj.innerUnitLabel) || '';
                if (unit === 'Base') unit = '';
            }

            if (!name || name === '1') {
                return unit || name || 'એકમ';
            }

            if (unit && unit.toLowerCase() !== name.toLowerCase() && !name.toLowerCase().includes(unit.toLowerCase())) {
                return `${name} ${unit}`.trim();
            }

            return name.trim();
        };

        // Process Customer Orders
        orders.forEach(order => {
            const bill = parseFloat(order.totalAmount || 0);
            const shopName = order.user?.businessProfile?.shopName || order.customerName || 'અજ્ઞાત દુકાન';
            const phone = order.user?.number || order.customerNumber || '';

            let orderCash = 0;
            let orderOnline = 0;
            let orderCredit = 0;

            const payments = Array.isArray(order.payments) ? order.payments : [];

            if (payments.length > 0) {
                payments.forEach(p => {
                    const amt = parseFloat(p.amount || 0);
                    const m = String(p.paymentMethod || p.method || p.paymentMode || '').toUpperCase();
                    if (m === 'CASH' || m.includes('ROKAD') || m.includes('રોકડ')) {
                        orderCash += amt;
                    } else if (m === 'CREDIT') {
                        orderCredit += amt;
                    } else if (amt > 0) {
                        orderOnline += amt;
                    }
                });
            } else {
                const paid = parseFloat(order.paidAmount || 0);
                const method = String(order.paymentMethod || '').toLowerCase();

                if (paid > 0) {
                    if (method.includes('online') || method.includes('upi') || method.includes('bank') || method.includes('qr') || method.includes('gpay') || method.includes('paytm') || method.includes('cheque')) {
                        orderOnline = paid;
                    } else {
                        orderCash = paid;
                    }
                } else if (order.paymentStatus === 'Paid') {
                    if (method.includes('online') || method.includes('upi') || method.includes('bank') || method.includes('qr')) {
                        orderOnline = bill;
                    } else {
                        orderCash = bill;
                    }
                }
            }

            const totalRealPaid = orderCash + orderOnline;
            const due = (order.dueAmount !== undefined && order.dueAmount !== null)
                ? parseFloat(order.dueAmount)
                : Math.max(0, bill - totalRealPaid);

            customerCash += orderCash;
            customerOnline += orderOnline;

            // Delivery Boy Breakdown
            const dbObj = order.assignment?.deliveryBoy;
            const dbId = dbObj?.id ? String(dbObj.id) : 'unassigned';
            const dbName = dbObj?.name || 'ડાયરેક્ટ (Unassigned)';

            if (!dbSummaryMap.has(dbId)) {
                dbSummaryMap.set(dbId, {
                    id: dbId,
                    name: dbName,
                    cash: 0,
                    online: 0,
                    credit: 0,
                    totalCollected: 0,
                    totalOrders: 0
                });
            }

            const dbEntry = dbSummaryMap.get(dbId);
            dbEntry.cash += orderCash;
            dbEntry.online += orderOnline;
            dbEntry.credit += due;
            dbEntry.totalCollected = dbEntry.cash + dbEntry.online;
            dbEntry.totalOrders += 1;

            collectedShops.push({
                orderId: order.orderId,
                shopName,
                customerName: order.user?.fullname || order.customerName || '',
                phone,
                deliveryBoyName: dbName,
                totalBill: bill,
                cash: orderCash,
                online: orderOnline,
                credit: due
            });

            if (due > 0.01) {
                totalPendingDue += due;
                pendingShops.push({
                    orderId: order.orderId,
                    shopName,
                    phone,
                    dueAmount: due
                });
            }

            (order.items || []).forEach(item => {
                const pObj = item.product || {};
                const pName = typeof pObj.name === 'object' ? (pObj.name.gu || pObj.name.en || 'Product') : (pObj.name || item.name || 'Product');
                const volumeDisplay = formatVolumeDisplay(item);

                const qty = parseFloat(item.quantity || 0);
                const itemPrice = parseFloat(item.price || 0);
                const sellingAmount = itemPrice * qty;

                const vObj = item.variant || item.variantInfo || {};
                const purchasePrice = parseFloat(vObj.purchasePrice || 0);
                const bUPP = parseFloat(vObj.baseUnitsPerPack || 1);
                let itemPurchaseCost = 0;
                if (item.sellUnit === 'Inner' && bUPP > 0) {
                    itemPurchaseCost = (purchasePrice / bUPP) * qty;
                } else {
                    itemPurchaseCost = purchasePrice * qty;
                }

                const mapKey = `${pName}_${volumeDisplay}`;
                if (stockMap.has(mapKey)) {
                    const existing = stockMap.get(mapKey);
                    existing.qty += qty;
                    existing.sellingAmount += sellingAmount;
                    existing.purchaseCost += itemPurchaseCost;
                } else {
                    stockMap.set(mapKey, {
                        name: pName,
                        volume: volumeDisplay,
                        qty,
                        sellingAmount,
                        purchaseCost: itemPurchaseCost
                    });
                }
            });
        });

        // Process Outlet Orders
        outletOrders.forEach(order => {
            const bill = parseFloat(order.totalAmount || order.grandTotal || 0);
            const paid = parseFloat(order.paidAmount || bill);
            const due = parseFloat(order.dueAmount || 0);

            let payments = Array.isArray(order.payments) ? order.payments : [];
            if (payments.length > 0) {
                payments.forEach(p => {
                    const amt = parseFloat(p.amount || 0);
                    const m = String(p.method || p.paymentMode || '').toLowerCase();
                    if (m.includes('cash') || m.includes('રોકડ')) {
                        outletCash += amt;
                    } else {
                        outletOnline += amt;
                    }
                });
            } else {
                const mode = String(order.paymentMode || 'cash').toLowerCase();
                if (mode.includes('cash') || mode.includes('રોકડ')) {
                    outletCash += paid;
                } else {
                    outletOnline += paid;
                }
            }

            if (due > 0.01) {
                totalPendingDue += due;
            }

            (order.items || []).forEach(item => {
                const pObj = item.product || {};
                const pName = typeof pObj.name === 'object' ? (pObj.name.gu || pObj.name.en || 'Product') : (pObj.name || item.name || 'Product');
                const volumeDisplay = formatVolumeDisplay(item);

                const qty = parseFloat(item.quantity || 0);
                const itemPrice = parseFloat(item.price || 0);
                const sellingAmount = itemPrice * qty;

                const vObj = item.variant || item.variantInfo || {};
                const purchasePrice = parseFloat(vObj.purchasePrice || 0);
                const bUPP = parseFloat(vObj.baseUnitsPerPack || 1);
                let itemPurchaseCost = 0;
                if (item.sellUnit === 'Inner' && bUPP > 0) {
                    itemPurchaseCost = (purchasePrice / bUPP) * qty;
                } else {
                    itemPurchaseCost = purchasePrice * qty;
                }

                const mapKey = `${pName}_${volumeDisplay}`;
                if (stockMap.has(mapKey)) {
                    const existing = stockMap.get(mapKey);
                    existing.qty += qty;
                    existing.sellingAmount += sellingAmount;
                    existing.purchaseCost += itemPurchaseCost;
                } else {
                    stockMap.set(mapKey, {
                        name: pName,
                        volume: volumeDisplay,
                        qty,
                        sellingAmount,
                        purchaseCost: itemPurchaseCost
                    });
                }
            });
        });

        const customerTotal = customerCash + customerOnline;
        const outletTotal = outletCash + outletOnline;
        const grandTotalCash = customerCash + outletCash;
        const grandTotalOnline = customerOnline + outletOnline;
        const totalCollected = customerTotal + outletTotal;

        // Sort stockList by product name so multiple volume items stay grouped together
        const stockList = Array.from(stockMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'gu'));
        const stockSellingTotal = stockList.reduce((sum, i) => sum + i.sellingAmount, 0);
        const stockPurchaseTotal = stockList.reduce((sum, i) => sum + i.purchaseCost, 0);
        const netProfit = stockSellingTotal - stockPurchaseTotal;

        const deliveryBoySummary = Array.from(dbSummaryMap.values());

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Customer payments report fetched successfully", {
            // Customer Payments
            customerCash,
            customerOnline,
            customerTotal,

            // Outlet Orders
            outletCash,
            outletOnline,
            outletTotal,

            // Combined Totals
            grandTotalCash,
            grandTotalOnline,
            totalCollected,
            totalPendingDue,

            // Delivery Boy Wise Summary
            deliveryBoySummary,

            // Shop Wise Collection List
            collectedShops,

            // Pending Shops List
            pendingShops,

            // Stock & Profit
            stockList,
            stockSellingTotal,
            stockPurchaseTotal,
            netProfit,
            totalOrders: orders.length + outletOrders.length
        });
    } catch (error) {
        logger.error(`[Customer Payments Report Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

