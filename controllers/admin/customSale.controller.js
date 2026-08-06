import { Order, OrderItem, Product, ProductVariant, ProductPricing, User, Volume, InventoryStock, InventoryTransaction, AppSettings, OrderPayment } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { roundTotal } from '../../utils/roundHelper.js';

/**
 * Generate a unique human-readable Order ID for Direct Sales
 */
const generateUniqueDirectSaleId = async () => {
    let nextId = 100001;
    const lastOrder = await Order.findOne({
        where: {
            orderId: {
                [Op.regexp]: '^[0-9]{5,6}$'
            }
        },
        order: [['createdAt', 'DESC']],
        attributes: ['orderId'],
        paranoid: false
    });

    if (lastOrder && lastOrder.orderId) {
        const numericPart = Number(lastOrder.orderId);
        nextId = Number.isFinite(numericPart) && numericPart >= 10000 ? numericPart + 1 : 100001;
    }

    // Ensure it is absolutely unique (including soft-deleted ones)
    let unique = false;
    while (!unique) {
        const existing = await Order.findOne({
            where: { orderId: String(nextId) },
            paranoid: false,
            attributes: ['id']
        });
        if (!existing) {
            unique = true;
        } else {
            nextId++;
        }
    }

    return String(nextId);
};

/**
 * @desc    Create a new Custom/Direct Sale
 * @route   POST /api/admin/custom-sales
 * @access  Private (Admin)
 */
export const createCustomSale = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { 
            userId, 
            customerName, 
            customerNumber,
            items, 
            paymentMethod, 
            paidAmount: rawPaidAmount,
            payments,
            deliveryCharge: rawDeliveryCharge,
            godownId,
            notes,
            orderStatus,
            deliveryMode,
            deliveryRoundId,
            deliveryRoundTiming,
            orderDate,
            deliveryDate
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Sale must contain at least one item.");
        }

        if (!godownId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Godown ID is required for stock deduction.");
        }

        // Pre-fetch user's applevel and routeCategoryId if userId is provided
        let userAppLevel = null;
        let resolvedRouteCategoryId = null;
        if (userId) {
            const userObj = await User.findByPk(userId, { transaction: t });
            if (userObj) {
                userAppLevel = userObj.applevel || null;
                resolvedRouteCategoryId = userObj.routeCategoryId || null;
            }
        }

        let totalAmount = 0;
        let totalDiscount = 0;
        const orderItemsData = [];

        // 1. Process Items and calculate total
        for (const item of items) {
            const { variantId, quantity, price: manualPrice } = item;

            const variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'innerUnitRef' },
                    { model: Volume, as: 'baseUnitRef' }
                ],
                transaction: t
            });

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product variant ${variantId} not found.`);
            }

            // Check Min Qty and Max Qty limits
            const minQ = (variant.minQty !== null && variant.minQty !== undefined && variant.minQty !== '') ? Number(variant.minQty) : null;
            const maxQ = (variant.maxQty !== null && variant.maxQty !== undefined && variant.maxQty !== '') ? Number(variant.maxQty) : null;
            const numQty = parseFloat(quantity || 1);

            const prodName = typeof variant.product?.name === 'object'
                ? (variant.product.name.gu || variant.product.name.en || Object.values(variant.product.name)[0])
                : (variant.product?.name || 'Product');

            if (minQ !== null && minQ > 0 && numQty < minQ) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `પ્રોડક્ટ '${prodName}' માટે ન્યૂનતમ જથ્થો (Min Qty) ${minQ} હોવો જોઈએ.`);
            }

            if (maxQ !== null && maxQ > 0 && numQty > maxQ) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `પ્રોડક્ટ '${prodName}' માટે મહત્તમ જથ્થો (Max Qty) ${maxQ} થી વધારે ન હોઈ શકે.`);
            }

            // Check stock availability in selected godown
            const bUPPCheck = Number(variant.baseUnitsPerPack || 1);
            const sellUnitCheck = item.sellUnit || 'Base';
            const reqBaseUnits = sellUnitCheck === 'Inner' ? Number(quantity) : (Number(quantity) * bUPPCheck);

            const totalAvailableStock = await InventoryStock.sum('totalBaseUnits', {
                where: {
                    productId: variant.productId,
                    godownId,
                    status: 'Active'
                },
                transaction: t
            }) || 0;

            if (totalAvailableStock <= 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `પ્રોડક્ટ '${prodName}' સ્ટોકમાં નથી (Out of stock).`);
            }

            if (totalAvailableStock < reqBaseUnits) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `પ્રોડક્ટ '${prodName}' નો પુરતો સ્ટોક નથી (માત્ર ${totalAvailableStock} યુનિટ ઉપલબ્ધ છે).`);
            }

            // Resolve regular selling price
            const pricings = await ProductPricing.findAll({
                where: { variantId },
                order: [['minQty', 'ASC']],
                transaction: t
            });

            let applicablePricing = null;

            if (userAppLevel) {
                applicablePricing = pricings.find(p =>
                    p.customLevelId === userAppLevel &&
                    p.minQty !== null && p.minQty !== undefined &&
                    numQty >= Number(p.minQty) &&
                    (p.maxQty === null || p.maxQty === undefined || numQty <= Number(p.maxQty))
                );
                if (!applicablePricing) {
                    applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
                }
            }

            if (!applicablePricing && pricings.length > 0) {
                applicablePricing = pricings.find(p =>
                    p.minQty !== null && p.minQty !== undefined &&
                    numQty >= Number(p.minQty) &&
                    (p.maxQty === null || p.maxQty === undefined || numQty <= Number(p.maxQty))
                );
                if (!applicablePricing) {
                    applicablePricing = pricings[0];
                }
            }

            let rawPrice = 0;
            if (applicablePricing) {
                rawPrice = parseFloat(applicablePricing.price);
            } else {
                rawPrice = parseFloat(variant.purchasePrice) || 0;
            }

            const bUPP = Number(variant.baseUnitsPerPack || 1);
            const sellUnit = item.sellUnit || 'Base';
            const regularPrice = sellUnit === 'Inner' ? (rawPrice / bUPP) : rawPrice;

            const itemPrice = parseFloat(manualPrice !== undefined && manualPrice !== null ? manualPrice : regularPrice);
            const itemSubtotal = itemPrice * parseFloat(quantity);
            totalAmount += itemSubtotal;

            // Calculate discount (regularPrice - itemPrice)
            let itemDiscount = 0;
            if (itemPrice < regularPrice) {
                itemDiscount = regularPrice - itemPrice;
            }
            totalDiscount += itemDiscount * parseFloat(quantity);
            
            orderItemsData.push({
                productId: variant.productId,
                variantId,
                quantity,
                price: itemPrice,
                discount: itemDiscount,
                sellUnit,
                variantInfo: {
                    productName: variant.product.name,
                    volume: variant.volume,
                    extra: variant.extra || '',
                    extraName: variant.extra || '',
                    image: variant.image || variant.product.thumbnail,
                    innerUnitLabel: variant.innerUnitRef?.name
                        ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                        : variant.innerUnitLabel || 'Pcs',
                    baseUnitLabel: variant.baseUnitRef?.name
                        ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                        : variant.baseUnitLabel || 'Pack',
                    sellingVolume: variant.sellingVolume,
                    baseUnitsPerPack: variant.baseUnitsPerPack || 1,
                    boxNumber: variant.product?.boxNumber || null
                }
            });
        }

        const deliveryCharge = parseFloat(rawDeliveryCharge || 0);
        const grandTotalAmount = roundTotal(totalAmount + deliveryCharge);

        // Resolve multiple payments
        let resolvedPayments = payments;
        let paidAmount = 0;

        if (Array.isArray(resolvedPayments) && resolvedPayments.length > 0) {
            paidAmount = resolvedPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        } else {
            const rawPaid = parseFloat(rawPaidAmount || 0);
            paidAmount = rawPaid;
            resolvedPayments = [];
            if (rawPaid > 0) {
                const isBank = paymentMethod !== 'Cash' && paymentMethod !== 'Credit' && paymentMethod;
                resolvedPayments.push({
                    method: isBank ? 'Bank Account' : 'Cash',
                    bankSettingId: isBank ? paymentMethod : null,
                    amount: rawPaid
                });
            }
        }

        const dueAmount = Math.max(0, grandTotalAmount - paidAmount);
        
        let paymentStatus = 'Pending';
        if (paidAmount >= grandTotalAmount) paymentStatus = 'Paid';
        else if (paidAmount > 0) paymentStatus = 'Partial';

        let orderPaymentMethod = 'Cash';
        if (resolvedPayments.length > 0) {
            const methods = [...new Set(resolvedPayments.map(p => p.method))];
            orderPaymentMethod = methods.join(', ');
        } else {
            orderPaymentMethod = paymentMethod || 'Cash';
        }

        const status = orderStatus || 'Delivered';
        const now = new Date();

        let resolvedDeliveryRoundTiming = deliveryRoundTiming;
        if (deliveryMode === 'Round' && deliveryRoundId) {
            const settings = await AppSettings.findOne({ transaction: t });
            if (settings && Array.isArray(settings.deliveryRoundSchedules)) {
                const normalizedSchedules = settings.deliveryRoundSchedules.map((round, index) => ({
                    id: round.id || `round_${index + 1}`,
                    ...round
                }));
                const matchedRound = normalizedSchedules.find(r => r.id === deliveryRoundId);
                if (matchedRound) {
                    resolvedDeliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                }
            }
        }

        // 2. Create the Order
        const newSale = await Order.create({
            orderId: await generateUniqueDirectSaleId(),
            userId: userId || null,
            customerName: userId ? null : customerName,
            customerNumber: userId ? null : customerNumber,
            totalAmount: grandTotalAmount,
            paidAmount,
            dueAmount,
            discount: totalDiscount,
            paymentMethod: orderPaymentMethod,
            paymentStatus,
            orderStatus: status,
            deliveryMode: deliveryMode || null,
            deliveryRoundId: deliveryMode === 'Round' ? (deliveryRoundId || null) : null,
            deliveryRoundTiming: deliveryMode === 'Round' ? (resolvedDeliveryRoundTiming || null) : null,
            deliveredAt: status === 'Delivered' ? now : null,
            shippingAt: (status === 'Shipping' || status === 'Delivered') ? now : null,
            packedAt: (status === 'Packed' || status === 'Shipping' || status === 'Delivered') ? now : null,
            packagingAt: (status === 'Packaging' || status === 'Packed' || status === 'Shipping' || status === 'Delivered') ? now : null,
            saleType: 'Direct',
            deliveryCharge,
            createdByAdminId: req.user?.id,
            notes,
            routeCategoryId: resolvedRouteCategoryId,
            godownId: req.body.godownId || null,
            orderDate: orderDate || new Date().toISOString().split('T')[0],
            deliveryDate: deliveryDate || null,
            ...(orderDate ? { createdAt: new Date(orderDate) } : {})
        }, { transaction: t });

        // 3. Create Order Items
        const finalOrderItems = orderItemsData.map(item => ({
            ...item,
            orderId: newSale.id
        }));

        await OrderItem.bulkCreate(finalOrderItems, { transaction: t });

        // 4. Deduct Stock from Inventory
        for (const item of orderItemsData) {
            const isLoose = item.sellUnit === 'Inner';
            const deductionRequired = isLoose ? item.quantity : (item.quantity * (item.variantInfo.baseUnitsPerPack || 1));
            
            const stocks = await InventoryStock.findAll({
                where: { 
                    productId: item.productId, 
                    godownId, 
                    totalBaseUnits: { [Op.gt]: 0 } 
                },
                order: [['createdAt', 'ASC']],
                transaction: t
            });

            let remainingToDeduct = deductionRequired;
            for (const stock of stocks) {
                if (remainingToDeduct <= 0) break;

                const deductFromThis = Math.min(stock.totalBaseUnits, remainingToDeduct);
                const newTotalBaseUnits = stock.totalBaseUnits - deductFromThis;
                
                await stock.update({ totalBaseUnits: newTotalBaseUnits }, { transaction: t });

                // Log the transaction
                await InventoryTransaction.create({
                    stockId: stock.id,
                    productId: item.productId,
                    variantId: item.variantId,
                    godownId,
                    type: 'SALE',
                    primaryUnitId: stock.primaryUnitId,
                    secondaryUnitId: stock.secondaryUnitId,
                    secondaryPerPrimary: stock.secondaryPerPrimary,
                    totalQtyBaseUnits: deductFromThis,
                    balanceAfterBaseUnits: newTotalBaseUnits,
                    note: `Direct Sale #${newSale.orderId}`,
                    createdBy: req.user?.name || 'Admin'
                }, { transaction: t });

                remainingToDeduct -= deductFromThis;
            }
            
            if (remainingToDeduct > 0) {
                // For direct sales, we might allow negative stock or just log a warning
                logger.warn(`[Direct Sale Stock Warning]: Order #${newSale.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId}`);
            }
        }

        // 5. Create Order Payment Records
        if (resolvedPayments && resolvedPayments.length > 0) {
            const paymentRecords = resolvedPayments.map(p => {
                const isBank = p.method === 'Bank Account' || (p.bankSettingId && p.bankSettingId !== 'Cash');
                return {
                    orderId: newSale.id,
                    amount: parseFloat(p.amount || 0),
                    paymentMethod: isBank ? 'ONLINE' : 'CASH',
                    bankSettingId: isBank ? p.bankSettingId : null,
                    onlineType: isBank ? 'Bank Account' : null,
                    isSubmitted: true,
                    submittedAt: now
                };
            });
            await OrderPayment.bulkCreate(paymentRecords, { transaction: t });
        }

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Custom sale recorded successfully.", newSale);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Create Custom Sale Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all Custom/Direct Sales
 * @route   GET /api/admin/custom-sales
 * @access  Private (Admin)
 */
export const getCustomSales = async (req, res) => {
    try {
        const { search, date, status, godownId } = req.query;
        const where = { saleType: 'Direct' };

        if (godownId) {
            where.godownId = godownId;
        }

        if (search) {
            // Global search bypasses tab and date constraints
            where[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerNumber: { [Op.iLike]: `%${search}%` } },
                { '$user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$user.number$': { [Op.iLike]: `%${search}%` } }
            ];
        } else {
            // Only filter by tab status and date when there is no active search query
            if (status && status !== 'All') {
                where.orderStatus = status;
            }

            if (date) {
                const startOfDay = new Date(date);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(date);
                endOfDay.setHours(23, 59, 59, 999);
                where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
            }
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Order.findAndCountAll({
            where,
            include: [
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number'] },
                { 
                    model: OrderItem, 
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'mainCategoryId'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        // ── Calculate Global Status Counts for Custom Sales ─────────────────────
        const todayStr = new Date().toISOString().split('T')[0];
        const startOfToday = new Date(todayStr);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(todayStr);
        endOfToday.setHours(23, 59, 59, 999);

        const countWhere = { saleType: 'Direct' };
        if (godownId) {
            countWhere.godownId = godownId;
        }

        const [pendingCount, packagingCount, packedCount, shippingCount, deliveredCount, paymentCollectCount, cancelledCount, todayCount] = await Promise.all([
            Order.count({ where: { ...countWhere, orderStatus: 'Pending' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Packaging' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Packed' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Shipping' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Delivered' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Payment Collect' } }),
            Order.count({ where: { ...countWhere, orderStatus: 'Cancelled' } }),
            Order.count({ where: { ...countWhere, createdAt: { [Op.between]: [startOfToday, endOfToday] } } })
        ]);

        const responseData = formatPaginatedResponse(result, page, limit);
        responseData.statusCounts = {
            '': responseData.totalRecords,
            Today: todayCount,
            Pending: pendingCount,
            Packaging: packagingCount,
            Packed: packedCount,
            Shipping: shippingCount,
            Delivered: deliveredCount,
            'Payment Collect': paymentCollectCount,
            Cancelled: cancelledCount
        };

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Custom sales fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get Custom Sales Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
