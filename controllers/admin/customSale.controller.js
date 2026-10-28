import { Order, OrderItem, Product, ProductVariant, ProductPricing, User, Volume, InventoryStock, InventoryTransaction, AppSettings, OrderPayment, BusinessProfile } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';
import { broadcastOrderCreated, broadcastOrderStatusChanged } from '../../services/socketEvent.service.js';
import { isSystemOrAuditNotice } from '../../services/financialSettlement.service.js';
import { adminCompleteOrderSettlementService } from '../../services/adminCompleteSettlement.service.js';

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
            couponAmount: rawCouponAmount,
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
        let resolvedCustomerName = customerName || null;
        let resolvedCustomerNumber = customerNumber || null;
        let userObj = null;
        if (userId) {
            userObj = await User.findByPk(userId, { transaction: t });
            if (userObj) {
                userAppLevel = userObj.applevel || null;
                resolvedRouteCategoryId = userObj.routeCategoryId || null;
                if (!resolvedCustomerName) resolvedCustomerName = userObj.fullname;
                if (!resolvedCustomerNumber) resolvedCustomerNumber = userObj.number;
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
        // Kupan is kept on couponDiscount (Party Ledger kupan column)
        const couponDiscount = Math.round((parseFloat(rawCouponAmount || 0) || 0) * 100) / 100;

        if (couponDiscount < 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "કુપન રકમ માઇનસ (-) ન હોઈ શકે.");
        }
        if (couponDiscount > grandTotalAmount) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "કુપન રકમ બિલ કરતાં વધુ ન હોઈ શકે.");
        }

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

        const netBillAmount = Math.round((grandTotalAmount - couponDiscount) * 100) / 100;
        const dueAmount = Math.max(0, netBillAmount - paidAmount);

        let paymentStatus = 'Pending';
        if (paidAmount >= netBillAmount) paymentStatus = 'Paid';
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

        let activeDeliveryNotice = null;
        if (userObj?.deliveryNotice && !isSystemOrAuditNotice(userObj.deliveryNotice)) {
            activeDeliveryNotice = String(userObj.deliveryNotice).replace(/^\[Delivery Note\]:\s*/i, '').trim();
        }

        // 2. Check for Existing Pending Order for this Party to Auto Merge
        let targetSale = null;
        let isMerged = false;

        // Merge recalculates the bill from its items only, so a bill with Kupan is never merged (kept as its own bill)
        if (userId && status === 'Pending' && couponDiscount <= 0) {
            const existingPendingOrder = await Order.findOne({
                where: {
                    userId,
                    orderStatus: 'Pending'
                },
                order: [['createdAt', 'DESC']],
                transaction: t
            });

            const pendingHasKupan = existingPendingOrder?.saleType === 'Direct' && Number(existingPendingOrder.couponDiscount || 0) > 0;

            if (existingPendingOrder && !pendingHasKupan) {
                targetSale = existingPendingOrder;
                isMerged = true;
                logger.info(`[createCustomSale] Found existing pending order #${targetSale.orderId} for party ${userId}. Auto-merging.`);
            }
        }

        if (!targetSale) {
            // Create new Order
            targetSale = await Order.create({
                orderId: await generateUniqueDirectSaleId(),
                userId: userId || null,
                customerName: resolvedCustomerName,
                customerNumber: resolvedCustomerNumber,
                totalAmount: grandTotalAmount,
                paidAmount,
                dueAmount,
                discount: totalDiscount,
                couponDiscount,
                discountType: couponDiscount > 0 ? 'Coupon Discount' : null,
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
                deliveryNotice: activeDeliveryNotice || null,
                routeCategoryId: resolvedRouteCategoryId,
                godownId: req.body.godownId || null,
                orderDate: orderDate || new Date().toISOString().split('T')[0],
                deliveryDate: deliveryDate || null,
                ...(orderDate ? { createdAt: new Date(orderDate) } : {})
            }, { transaction: t });

            // 3. Create Order Items
            const finalOrderItems = orderItemsData.map(item => ({
                ...item,
                orderId: targetSale.id
            }));
            await OrderItem.bulkCreate(finalOrderItems, { transaction: t });
        } else {
            // Merge Order Items into existing pending order
            for (const item of orderItemsData) {
                const matchedItem = await OrderItem.findOne({
                    where: {
                        orderId: targetSale.id,
                        variantId: item.variantId,
                        sellUnit: item.sellUnit || 'Base'
                    },
                    transaction: t
                });

                if (matchedItem) {
                    const newQty = Number(matchedItem.quantity) + Number(item.quantity);
                    await matchedItem.update({ quantity: newQty }, { transaction: t });
                } else {
                    await OrderItem.create({
                        ...item,
                        orderId: targetSale.id
                    }, { transaction: t });
                }
            }

            // Recalculate totals from all items in targetSale
            const allItems = await OrderItem.findAll({
                where: { orderId: targetSale.id },
                transaction: t
            });

            let newSubtotal = 0;
            for (const it of allItems) {
                const price = Number(it.price || 0);
                const qty = Number(it.quantity || 0);
                const disc = Number(it.discount || 0);
                newSubtotal += Math.max(0, (price * qty) - disc);
            }

            const newDeliveryCharge = Number(targetSale.deliveryCharge || 0) + Number(deliveryCharge || 0);
            const newTotalAmount = Math.round((newSubtotal + newDeliveryCharge) * 100) / 100;
            const newPaidAmount = Math.round((Number(targetSale.paidAmount || 0) + Number(paidAmount || 0)) * 100) / 100;
            const newDueAmount = Math.max(0, Math.round((newTotalAmount - newPaidAmount) * 100) / 100);

            let newPaymentStatus = 'Pending';
            if (newPaidAmount >= newTotalAmount && newTotalAmount > 0) newPaymentStatus = 'Paid';
            else if (newPaidAmount > 0) newPaymentStatus = 'Partial';

            await targetSale.update({
                totalAmount: newTotalAmount,
                paidAmount: newPaidAmount,
                dueAmount: newDueAmount,
                deliveryCharge: newDeliveryCharge,
                paymentStatus: newPaymentStatus,
                isMerged: true,
                ...(notes ? { notes: targetSale.notes ? `${targetSale.notes}\n${notes}` : notes } : {})
            }, { transaction: t });
        }

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
                    note: isMerged ? `Direct Sale (Merged into #${targetSale.orderId})` : `Direct Sale #${targetSale.orderId}`,
                    createdBy: req.user?.name || 'Admin'
                }, { transaction: t });

                remainingToDeduct -= deductFromThis;
            }
            
            if (remainingToDeduct > 0) {
                // For direct sales, we might allow negative stock or just log a warning
                logger.warn(`[Direct Sale Stock Warning]: Order #${targetSale.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId}`);
            }
        }

        // 5. Create Order Payment Records
        if (resolvedPayments && resolvedPayments.length > 0) {
            const paymentRecords = resolvedPayments.map(p => {
                const isBank = p.method === 'Bank Account' || (p.bankSettingId && p.bankSettingId !== 'Cash');
                return {
                    orderId: targetSale.id,
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

        // Deduct from User creditline if order was placed on Credit
        if (userId && (orderPaymentMethod === 'CREDIT' || (Array.isArray(payments) && payments.some(p => p.method === 'CREDIT')))) {
            const user = await User.findByPk(userId, { transaction: t });
            if (user) {
                const creditUsed = Array.isArray(payments) && payments.length > 0
                    ? payments.filter(p => p.method === 'CREDIT').reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0)
                    : dueAmount;

                if (creditUsed > 0) {
                    const unpaidOrders = await Order.findAll({
                        where: {
                            userId: user.id,
                            dueAmount: { [Op.gt]: 0 },
                            id: { [Op.ne]: targetSale.id },
                            orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
                        },
                        attributes: ['dueAmount'],
                        transaction: t
                    });
                    const prevDues = unpaidOrders.reduce((sum, o) => sum + parseFloat(o.dueAmount || 0), 0);
                    const baseCredit = parseFloat(user.creditline || 0);
                    const prevAvail = Math.max(0, baseCredit - prevDues);
                    const newAvail = Math.max(0, prevAvail - creditUsed);

                    const PartyBalanceLog = User.sequelize.models.PartyBalanceLog;
                    if (PartyBalanceLog) {
                        await PartyBalanceLog.create({
                            userId: user.id,
                            orderId: targetSale.id,
                            type: 'DUE',
                            amount: creditUsed,
                            previousBalance: prevAvail,
                            newBalance: newAvail,
                            note: `Custom Sale #${targetSale.orderId} placed on Credit: -₹${creditUsed.toFixed(2)}. Remaining Available Credit: ₹${newAvail.toFixed(2)}`,
                            createdByName: req.user?.fullname || 'Admin'
                        }, { transaction: t });
                    }
                }
            }
        }

        await t.commit();

        // Broadcast socket real-time update
        try {
            const freshSaleForSocket = await Order.findByPk(targetSale.id, {
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'fullname', 'number', 'city', 'routeCategoryId'],
                        include: [{ model: User.sequelize.models.BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress', 'area'] }]
                    }
                ]
            });
            broadcastOrderCreated(freshSaleForSocket || targetSale);
        } catch (sErr) {
            logger.error(`[Socket Broadcast Error on createCustomSale]: ${sErr.message}`);
        }

        logActivity(req, {
            module: 'Custom Sales',
            action: isMerged ? 'UPDATE' : 'CREATE',
            description: isMerged 
                ? `Auto-merged Outlet Order into existing Pending Order #${targetSale.orderId} for customer ${targetSale.customerName || 'Customer'} (New Total: ₹${targetSale.totalAmount})`
                : `Created Custom Sale #${targetSale.orderId} for customer ${targetSale.customerName || 'Customer'} (Total: ₹${targetSale.totalAmount})`,
            metadata: { orderId: targetSale.id, orderNo: targetSale.orderId, totalAmount: targetSale.totalAmount, isMerged }
        });
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, isMerged ? `Order auto-merged successfully into existing Pending Order #${targetSale.orderId}` : "Custom sale recorded successfully.", targetSale);
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
                { '$user.number$': { [Op.iLike]: `%${search}%` } },
                { '$user.businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$user.businessProfile.shopNameAlt$': { [Op.iLike]: `%${search}%` } }
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
                { 
                    model: User, 
                    as: 'user', 
                    attributes: ['id', 'fullname', 'number'],
                    include: [
                        {
                            model: BusinessProfile,
                            as: 'businessProfile',
                            required: false,
                            attributes: ['id', 'shopName', 'shopNameAlt']
                        }
                    ]
                },
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

        const [pendingCount, shippingCount, deliveredCount, paymentCollectCount, cancelledCount, todayCount] = await Promise.all([
            Order.count({ where: { ...countWhere, orderStatus: 'Pending' } }),
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

/**
 * @desc    Payment Status step of New Outlet Order: settle the printed custom sale bill and complete it.
 *          The bill is moved to Shipping, then settled by the admin Complete & Settle service (→ Payment Collect),
 *          so Cash / Online / Kupan / Credit reach the Party Ledger the same way as every other completed bill.
 * @route   PUT /api/admin/custom-sales/:id/complete
 * @access  Private (Admin)
 */
export const completeCustomSale = async (req, res) => {
    try {
        const order = await Order.findByPk(req.params.id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }
        if (!['Pending', 'Packaging', 'Packed', 'Shipping'].includes(order.orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `આ ઓર્ડર ${order.orderStatus} માં છે, અહીંથી Complete થઈ શકે નહીં.`);
        }

        // Restored if the settlement is refused (e.g. amount still remaining)
        const previousState = {
            orderStatus: order.orderStatus,
            packagingAt: order.packagingAt,
            packedAt: order.packedAt,
            shippingAt: order.shippingAt
        };

        if (order.orderStatus !== 'Shipping') {
            const now = new Date();
            await order.update({
                orderStatus: 'Shipping',
                packagingAt: order.packagingAt || now,
                packedAt: order.packedAt || now,
                shippingAt: order.shippingAt || now
            });
        }

        const actorName = req.user?.fullname || req.user?.name || 'Admin';
        let result;
        try {
            result = await adminCompleteOrderSettlementService({ orderId: order.id, body: req.body, actorName });
        } catch (settleError) {
            await order.update(previousState);
            throw settleError;
        }

        if (result.notFound || result.error) {
            await order.update(previousState);
            return result.notFound
                ? sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.")
                : sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, result.error);
        }

        logActivity(req, {
            module: 'Custom Sales',
            action: 'PAYMENT',
            description: `Custom Sale #${result.order.orderId} payment confirmed & completed`,
            metadata: result.order
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "ઓર્ડર Complete થયો અને પેમેન્ટ સેટલ થયું.", result.order);
    } catch (error) {
        logger.error(`[Complete Custom Sale Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
