import { Order, OrderItem, Product, ProductVariant, User, Volume, Cart, AppSettings, InventoryStock, InventoryTransaction, Godown, AdminNotification, ProductPricing, SalesReturn, Notification } from '../../models/index.js';
import { emitAdminNotification } from '../../socket.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import { roundTotal } from '../../utils/roundHelper.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { sendToDevice } from '../../services/notification.service.js';

/**
 * Generate a unique human-readable Order ID
 */
const generateUniqueOrderId = async () => {
    const lastOrder = await Order.findOne({
        order: [['createdAt', 'DESC']],
        attributes: ['orderId']
    });

    if (!lastOrder || !lastOrder.orderId) {
        return '1001';
    }

    const numericPart = Number(lastOrder.orderId.replace(/\D/g, ''));
    const nextId = Number.isFinite(numericPart) && numericPart >= 1000 ? numericPart + 1 : 1001;
    return `${nextId}`;
};

const ensureVolumeObject = (vol) => {
    if (!vol) {
        return { en: '', gu: '', hn: '' };
    }

    // If it's already an object, clean and return it
    if (typeof vol === 'object') {
        return {
            en: String(vol.en || vol.gu || vol.hn || ''),
            gu: String(vol.gu || vol.en || vol.hn || ''),
            hn: String(vol.hn || vol.en || vol.gu || '')
        };
    }

    // If it's a string, check if it's JSON stringified
    if (typeof vol === 'string') {
        const trimmed = vol.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed && typeof parsed === 'object') {
                    return {
                        en: String(parsed.en || parsed.gu || parsed.hn || ''),
                        gu: String(parsed.gu || parsed.en || parsed.hn || ''),
                        hn: String(parsed.hn || parsed.en || parsed.gu || '')
                    };
                }
            } catch (e) {
                // Not valid JSON, fall through
            }
        }
        return {
            en: trimmed,
            gu: trimmed,
            hn: trimmed
        };
    }

    // For numbers/etc.
    const strVal = String(vol);
    return {
        en: strVal,
        gu: strVal,
        hn: strVal
    };
};

const normalizeOrderItem = (item) => {
    const itemData = item.toJSON ? item.toJSON() : item;
    if (itemData.variant) {
        itemData.variant.extraName = itemData.variant.extra || '';
        itemData.variant.extra = itemData.variant.extra || '';
        itemData.variant.volume = ensureVolumeObject(itemData.variant.volume);
    }
    if (itemData.variantInfo) {
        delete itemData.variantInfo.volume;
        if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
        if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
    }
    return itemData;
};

const formatOrderItems = (items) => {
    return (items || []).map(normalizeOrderItem);
};

const normalizeOrder = (order) => {
    if (!order) return null;
    const orderData = order.toJSON ? order.toJSON() : order;

    // 1. Clean items
    if (orderData.items) {
        orderData.items = orderData.items.map(normalizeOrderItem);
    } else {
        orderData.items = [];
    }

    // 2. Clean returns: Ensure returns is always an array [] (not null or [null])
    if (orderData.returns) {
        orderData.returns = orderData.returns.filter(r => r !== null && r !== undefined && r.id).map(r => {
            if (r.variant) {
                r.variant.volume = ensureVolumeObject(r.variant.volume);
            }
            return r;
        });
    } else {
        orderData.returns = [];
    }

    // 3. Clean user object: Ensure it is always an object, not null or undefined
    if (!orderData.user) {
        orderData.user = {
            id: orderData.userId || '',
            fullname: orderData.customerName || 'Guest',
            number: orderData.customerNumber || '',
            email: '',
            city: '',
            postcode: ''
        };
    } else {
        orderData.user.id = orderData.user.id || orderData.userId || '';
        orderData.user.fullname = orderData.user.fullname || orderData.customerName || 'Guest';
        orderData.user.number = orderData.user.number || orderData.customerNumber || '';
        orderData.user.email = orderData.user.email || '';
        orderData.user.city = orderData.user.city || '';
        orderData.user.postcode = orderData.user.postcode || '';
    }

    // 4. Amount Keys Consistency
    const discountVal = parseFloat(orderData.discountAmount || orderData.savedAmount || orderData.totalDiscount || 0);
    orderData.savedAmount = discountVal;
    orderData.discountAmount = discountVal;
    orderData.totalDiscount = discountVal;

    orderData.totalAmount = roundTotal(orderData.totalAmount);
    orderData.dueAmount = roundTotal(orderData.dueAmount);
    orderData.paidAmount = roundTotal(orderData.paidAmount);

    if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
        orderData.orderStatus = 'Delivered';
    }

    // 5. Standard response structure compatibility:
    // Create a copy of orderData (excluding circular reference) for orderDetails
    const detailsCopy = { ...orderData };
    orderData.orderDetails = detailsCopy;

    return orderData;
};

/**
 * @desc    Create a new order (Checkout)
 * @route   POST /api/user/orders
 * @access  Private
 */
export const createOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            items,
            paymentMethod,
            deliveryMode,
            deliveryRoundId,
            totalAmount: frontendTotalAmount // Total sent from frontend for validation
        } = req.body;

        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        // Fetch User and target Godown at the beginning for stock validation
        const userData = await User.findByPk(userId, { transaction: t });
        if (!userData) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
        }

        let targetGodownId = null;
        if (userData.postcode) {
            const godown = await Godown.findOne({
                where: { pincodes: { [Op.contains]: [userData.postcode] } },
                transaction: t
            });
            if (godown) targetGodownId = godown.id;
        }

        if (!targetGodownId) {
            const mainGodown = await Godown.findOne({ where: { type: 'main' }, transaction: t });
            if (mainGodown) targetGodownId = mainGodown.id;
        }

        if (!targetGodownId) {
            const anyGodown = await Godown.findOne({ transaction: t });
            if (anyGodown) targetGodownId = anyGodown.id;
        }

        let calculatedSubtotal = 0;
        const orderItemsData = [];
        const outOfStockItems = [];

        // 1. Perform stock check for all items first
        for (const item of items) {
            const { productId, variantId, quantity, sellUnit } = item;

            // Fetch Product and Variant
            const variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ],
                transaction: t
            });

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product variant ${variantId} not found.`);
            }

            const bUPP = Number(variant.baseUnitsPerPack || 1);

            // Volume-wise/Unit-wise stock check
            const deductionRequired = Math.round(sellUnit === 'Inner'
                ? Number(quantity)
                : Number(quantity) * bUPP);

            if (variant.product?.isCombo) {
                // Find matching or default variant for Combo Product 1
                let combo1Variant = await ProductVariant.findOne({
                    where: {
                        productId: variant.product.comboProduct1Id,
                        ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                    },
                    transaction: t
                }) || await ProductVariant.findOne({
                    where: { productId: variant.product.comboProduct1Id },
                    transaction: t
                });

                // Find matching or default variant for Combo Product 2
                let combo2Variant = await ProductVariant.findOne({
                    where: {
                        productId: variant.product.comboProduct2Id,
                        ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                    },
                    transaction: t
                }) || await ProductVariant.findOne({
                    where: { productId: variant.product.comboProduct2Id },
                    transaction: t
                });

                if (!combo1Variant || !combo2Variant) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Combo components variants not found for this product.`);
                }

                const bUPP1 = Number(combo1Variant.baseUnitsPerPack || 1);
                const deduction1 = Math.round(sellUnit === 'Inner' ? Number(quantity) : Number(quantity) * bUPP1);

                const bUPP2 = Number(combo2Variant.baseUnitsPerPack || 1);
                const deduction2 = Math.round(sellUnit === 'Inner' ? Number(quantity) : Number(quantity) * bUPP2);

                let stock1 = 0;
                if (targetGodownId) {
                    stock1 = await InventoryStock.sum('totalBaseUnits', {
                        where: {
                            productId: variant.product.comboProduct1Id,
                            godownId: targetGodownId,
                            totalBaseUnits: { [Op.gt]: 0 }
                        },
                        transaction: t
                    }) || 0;
                }

                if (deduction1 > stock1) {
                    const prod1 = await Product.findByPk(variant.product.comboProduct1Id, { transaction: t });
                    const prod1Name = prod1?.name ? (prod1.name.en || Object.values(prod1.name)[0] || 'Product 1') : 'Product 1';
                    outOfStockItems.push({
                        productId: variant.product.comboProduct1Id,
                        variantId: combo1Variant.id,
                        productName: `${prod1Name} (Combo Component)`,
                        availableQty: stock1,
                        unitLabel: 'units',
                        requestedQty: deduction1
                    });
                }

                let stock2 = 0;
                if (targetGodownId) {
                    stock2 = await InventoryStock.sum('totalBaseUnits', {
                        where: {
                            productId: variant.product.comboProduct2Id,
                            godownId: targetGodownId,
                            totalBaseUnits: { [Op.gt]: 0 }
                        },
                        transaction: t
                    }) || 0;
                }

                if (deduction2 > stock2) {
                    const prod2 = await Product.findByPk(variant.product.comboProduct2Id, { transaction: t });
                    const prod2Name = prod2?.name ? (prod2.name.en || Object.values(prod2.name)[0] || 'Product 2') : 'Product 2';
                    outOfStockItems.push({
                        productId: variant.product.comboProduct2Id,
                        variantId: combo2Variant.id,
                        productName: `${prod2Name} (Combo Component)`,
                        availableQty: stock2,
                        unitLabel: 'units',
                        requestedQty: deduction2
                    });
                }
            } else {
                // NORMAL PRODUCT STOCK CHECK
                let availableStock = 0;
                if (targetGodownId) {
                    const totalStock = await InventoryStock.sum('totalBaseUnits', {
                        where: {
                            productId: item.productId,
                            godownId: targetGodownId,
                            totalBaseUnits: { [Op.gt]: 0 }
                        },
                        transaction: t
                    });
                    availableStock = parseFloat(totalStock) || 0;
                }

                if (deductionRequired > availableStock) {
                    // Build friendly product name
                    const productName = typeof variant.product?.name === 'object'
                        ? (variant.product.name.en || Object.values(variant.product.name)[0] || 'Product')
                        : (variant.product?.name || 'Product');

                    // Determine the unit label shown to the user
                    const unitLabel = sellUnit === 'Inner'
                        ? (variant.innerUnitRef?.name
                            ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel || 'Unit')
                            : (variant.innerUnitLabel || 'Unit'))
                        : (variant.baseUnitRef?.name
                            ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel || 'Pack')
                            : (variant.baseUnitLabel || 'Pack'));

                    // Convert available base units back to user-facing unit quantity
                    const availableInUserUnit = sellUnit === 'Inner'
                        ? Math.floor(availableStock)
                        : Math.floor(availableStock / bUPP);

                    outOfStockItems.push({
                        productId: item.productId,
                        variantId: item.variantId,
                        productName,
                        availableQty: availableInUserUnit,
                        unitLabel,
                        requestedQty: quantity
                    });
                }
            }
        }

        // If any items are out of stock, reject the entire order with list
        if (outOfStockItems.length > 0) {
            await t.rollback();
            return sendErrorResponse(
                res,
                HTTP_STATUS.BAD_REQUEST,
                "Insufficient stock for some products.",
                { outOfStockItems }
            );
        }

        // 2. Fetch prices, build order items and subtotal since everything is in stock
        for (const item of items) {
            const { productId, variantId, quantity, sellUnit } = item;

            const variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ],
                transaction: t
            });

            const bUPP = Number(variant.baseUnitsPerPack || 1);

            // Fetch all pricings for this variant
            const pricings = await ProductPricing.findAll({
                where: { variantId },
                order: [['minQty', 'ASC']]
            });

            // Find applicable pricing based on user's applevel and quantity
            let applicablePricing = pricings.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );

            // Fallback logic
            if (!applicablePricing) {
                applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
            }
            if (!applicablePricing && pricings.length > 0) {
                applicablePricing = pricings[0];
            }

            let rawPrice = 0;
            if (applicablePricing) {
                rawPrice = parseFloat(applicablePricing.price);
            } else {
                rawPrice = parseFloat(variant.purchasePrice) || 0;
            }

            // Logic: Price per pack vs Price per piece
            // If selling in pieces (Inner), we use price/bUPP. If in cartons (Base), we use rawPrice.
            const itemPrice = sellUnit === 'Inner' ? (rawPrice / bUPP) : rawPrice;
            const itemSubtotal = itemPrice * parseFloat(quantity);
            calculatedSubtotal += itemSubtotal;

            orderItemsData.push({
                productId,
                variantId,
                quantity,
                price: itemPrice,
                sellUnit, // Important: Store the unit purchased
                variantInfo: {
                    productName: variant.product.name,
                    volume: variant.volume,
                    extra: variant.extra || '',
                    extraName: variant.extra || '',
                    image: variant.image || variant.product.thumbnail,
                    innerUnitLabel: variant.innerUnitRef?.name
                        ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel)
                        : variant.innerUnitLabel,
                    baseUnitLabel: variant.baseUnitRef?.name
                        ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel)
                        : variant.baseUnitLabel,
                    sellingVolume: variant.sellingVolume
                }
            });
        }

        // 3. Calculate delivery charge and final total
        const settings = await AppSettings.findOne({ transaction: t });
        let deliveryCharge = 0;
        if (settings && calculatedSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
            if (deliveryMode === 'Express') deliveryCharge = parseFloat(settings.expressDeliveryCharge);
            else if (deliveryMode === 'Round') deliveryCharge = parseFloat(settings.deliveryOnRoundCharge);
        }

        // Calculate final total (Subtotal + Delivery Charge)
        const backendTotal = calculatedSubtotal + deliveryCharge;

        // Validate with frontend total (allowing for small rounding differences)
        if (frontendTotalAmount && Math.abs(parseFloat(frontendTotalAmount) - backendTotal) > 1) {
            logger.warn(`[Order Total Discrepancy]: Frontend: ${frontendTotalAmount}, Backend: ${backendTotal} for User: ${userId}`);
        }

        const finalTotal = roundTotal(backendTotal);

        // 4. Handle Payment and Credit Line
        let paymentStatus = 'Pending';
        const method = paymentMethod?.toUpperCase();

        if (method === 'CREDIT') {
            const user = await User.findByPk(userId, { transaction: t });
            if (!user) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
            }

            const currentCredit = parseFloat(user.creditline) || 0;
            if (currentCredit < finalTotal) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Insufficient credit line. Available: ${currentCredit}, Required: ${finalTotal}`);
            }

            // Do NOT deduct from credit line during order creation as per user request (ત્યારે ક્રેડિટ કટ નથી કરવાની)
            paymentStatus = 'Pending'; // Set to Pending so CREDIT orders are treated as outstanding dues (baki)
        } else if (method === 'ONLINE') {
            paymentStatus = 'Pending';
        } else {
            paymentStatus = 'Pending';
        }

        // Find delivery round timing details if delivery mode is Round
        let deliveryRoundIdVal = null;
        let deliveryRoundTimingVal = null;
        if (deliveryMode === 'Round' && deliveryRoundId && settings) {
            const matchedRound = (settings.deliveryRoundSchedules || []).find(r => r.id === deliveryRoundId);
            if (matchedRound) {
                deliveryRoundIdVal = matchedRound.id;
                deliveryRoundTimingVal = `${matchedRound.name} (${matchedRound.start} - ${matchedRound.end})`;
            }
        } else if (deliveryMode === 'Express') {
            deliveryRoundIdVal = 'express';
            deliveryRoundTimingVal = 'Express Delivery';
        }

        // 5. Create the Order
        const newOrder = await Order.create({
            orderId: await generateUniqueOrderId(),
            userId,
            totalAmount: finalTotal,
            paidAmount: paymentStatus === 'Paid' ? finalTotal : 0,
            dueAmount: paymentStatus === 'Paid' ? 0 : finalTotal,
            paymentMethod,
            paymentStatus,
            orderStatus: 'Pending',
            deliveryMode,
            deliveryCharge,
            deliveryRoundId: deliveryRoundIdVal,
            deliveryRoundTiming: deliveryRoundTimingVal
        }, { transaction: t });

        // 6. Create Order Items
        const finalOrderItems = orderItemsData.map(item => ({
            ...item,
            orderId: newOrder.id
        }));

        await OrderItem.bulkCreate(finalOrderItems, { transaction: t });

        // 7. Clear Cart
        await Cart.destroy({ where: { userId }, transaction: t });

        // 8. Deduct Stock from Inventory
        if (targetGodownId) {
            for (const item of orderItemsData) {
                const variant = await ProductVariant.findByPk(item.variantId, {
                    include: [{ model: Product, as: 'product' }],
                    transaction: t
                });
                if (!variant) continue;

                if (variant.product?.isCombo) {
                    // DEDUCT FROM COMBO COMPONENTS!
                    const comboProducts = [
                        { id: variant.product.comboProduct1Id, key: 'comboProduct1' },
                        { id: variant.product.comboProduct2Id, key: 'comboProduct2' }
                    ];

                    for (const cp of comboProducts) {
                        const compVariant = await ProductVariant.findOne({
                            where: {
                                productId: cp.id,
                                ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                            },
                            transaction: t
                        }) || await ProductVariant.findOne({
                            where: { productId: cp.id },
                            transaction: t
                        });

                        if (!compVariant) continue;

                        const compBUPP = Number(compVariant.baseUnitsPerPack || 1);
                        const compDeduction = Math.round(item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * compBUPP);

                        const stocks = await InventoryStock.findAll({
                            where: {
                                productId: cp.id,
                                godownId: targetGodownId,
                                totalBaseUnits: { [Op.gt]: 0 }
                            },
                            order: [['createdAt', 'ASC']],
                            transaction: t
                        });

                        let remainingToDeduct = compDeduction;
                        for (const stock of stocks) {
                            if (remainingToDeduct <= 0) break;

                            const deductFromThis = Math.min(stock.totalBaseUnits, remainingToDeduct);
                            const newTotalBaseUnits = stock.totalBaseUnits - deductFromThis;

                            await stock.update({ totalBaseUnits: newTotalBaseUnits }, { transaction: t });

                            // Log the transaction
                            await InventoryTransaction.create({
                                stockId: stock.id,
                                productId: cp.id,
                                variantId: compVariant.id,
                                godownId: targetGodownId,
                                type: 'SALE',
                                primaryUnitId: stock.primaryUnitId,
                                secondaryUnitId: stock.secondaryUnitId,
                                secondaryPerPrimary: stock.secondaryPerPrimary,
                                totalQtyBaseUnits: deductFromThis,
                                balanceAfterBaseUnits: newTotalBaseUnits,
                                note: `Sales Order #${newOrder.orderId} (Combo Component)`,
                                createdBy: req.user?.fullname || 'Customer'
                            }, { transaction: t });

                            remainingToDeduct -= deductFromThis;
                        }

                        if (remainingToDeduct > 0) {
                            logger.warn(`[Stock Deduction Shortfall]: Order #${newOrder.orderId} - Shortfall of ${remainingToDeduct} base units for combo component variant ${compVariant.id} in Godown ${targetGodownId}`);
                        }
                    }
                } else {
                    // NORMAL PRODUCT STOCK DEDUCTION
                    const deductionRequired = Math.round(item.sellUnit === 'Inner'
                        ? Number(item.quantity)
                        : Number(item.quantity) * (variant.baseUnitsPerPack || 1));

                    // Find available stock batches for this variant in the target godown (FIFO)
                    const stocks = await InventoryStock.findAll({
                        where: {
                            productId: item.productId,
                            godownId: targetGodownId,
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
                            godownId: targetGodownId,
                            type: 'SALE',
                            primaryUnitId: stock.primaryUnitId,
                            secondaryUnitId: stock.secondaryUnitId,
                            secondaryPerPrimary: stock.secondaryPerPrimary,
                            totalQtyBaseUnits: deductFromThis,
                            balanceAfterBaseUnits: newTotalBaseUnits,
                            note: `Sales Order #${newOrder.orderId}`,
                            createdBy: req.user?.fullname || 'Customer'
                        }, { transaction: t });

                        remainingToDeduct -= deductFromThis;
                    }

                    if (remainingToDeduct > 0) {
                        logger.warn(`[Stock Deduction]: Order #${newOrder.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId} in Godown ${targetGodownId}`);
                    }
                }
            }
        } else {
            logger.error(`[Stock Deduction]: No Godown found to deduct stock for Order #${newOrder.orderId}`);
        }

        await t.commit();

        // 9. Trigger Admin Notification (Real-time)
        try {
            const adminNotify = await AdminNotification.create({
                title: 'New Order Received!',
                message: `User ${userData.fullname} has placed a new order #${newOrder.orderId} of ₹${newOrder.totalAmount}.`,
                type: 'ORDER',
                referenceId: newOrder.id,
                clickAction: `/sales/user-orders`
            });
            emitAdminNotification(adminNotify);
        } catch (notifyErr) {
            console.error('[Admin Notification Error]:', notifyErr);
            logger.error(`[Admin Notification Error]: ${notifyErr.message}`);
        }

        // 10. Trigger User Push Notification
        try {
            if (userData.fcmtoken) {
                const userTitle = 'Your Order Successful!';
                const userBody = `Hey ${userData.fullname}, your order #${newOrder.orderId} of ₹${newOrder.totalAmount} has been placed successfully!`;
                // Use type: 'order' so that it plays the custom orderDetails notification sound/channel
                await sendToDevice(userData.fcmtoken, userTitle, userBody, null, { type: 'order', id: String(newOrder.id), orderId: String(newOrder.id) });
                await Notification.create({
                    title: userTitle,
                    body: userBody,
                    type: 'ORDER',
                    target: String(newOrder.userId),
                    status: 'SENT',
                    clickAction: String(newOrder.id)
                });
            }
        } catch (pushErr) {
            console.error('[User Push Notification Error]:', pushErr);
            logger.error(`[User Push Notification Error]: ${pushErr.message}`);
        }

        // Fetch the created order with full details and user so we can normalize it!
        const createdOrder = await Order.findByPk(newOrder.id, {
            include: [
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'extra'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ]
        });

        const normalized = normalizeOrder(createdOrder || newOrder);
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Order placed successfully.", normalized);
    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Create Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all orders for the logged-in user
 * @route   GET /api/user/orders
 * @access  Private
 */
export const getOrders = async (req, res) => {
    try {
        const userId = req.user.id;
        const { id, paginate, page: queryPage, limit: queryLimit } = req.query;

        console.log(`[Debug getOrders API] userId: ${userId}, query: ${JSON.stringify(req.query)}`);

        const where = { userId };
        if (id) {
            where.id = id;
        }

        const include = [
            { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
            {
                model: OrderItem,
                as: 'items',
                include: [
                    { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'image', 'extra'],
                        include: [
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                        ]
                    }
                ]
            },
            {
                model: SalesReturn,
                as: 'returns',
                include: [
                    { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                        include: [
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                        ]
                    }
                ]
            }
        ];

        const orderOptions = [['createdAt', 'DESC']];

        // Backward compatibility: if page & limit are not provided (old app), return all data
        const shouldPaginate = (queryPage || queryLimit) && paginate !== 'false';

        if (!shouldPaginate) {
            const orders = await Order.findAll({
                where,
                include,
                order: orderOptions
            });

            console.log(`[Debug getOrders API] Non-paginated path. Found ${orders.length} orders.`);

            const updatedOrders = orders.map(normalizeOrder);

            if (updatedOrders && updatedOrders.length > 0) {
                const firstOrder = updatedOrders[0];
                console.log(`[Debug getOrders API] (Non-paginated) Sample Order Details:`, {
                    id: firstOrder.id,
                    orderId: firstOrder.orderId,
                    returns: firstOrder.returns,
                    user: firstOrder.user,
                    firstItemVolume: firstOrder.items?.[0]?.variantInfo?.volume,
                    firstItemVariantVolume: firstOrder.items?.[0]?.variant?.volume
                });
            }

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders fetched successfully.", updatedOrders);
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await Order.findAndCountAll({
            where,
            include,
            limit,
            offset,
            order: orderOptions,
            distinct: true
        });

        console.log(`[Debug getOrders API] Paginated path. Total count: ${result.count}`);

        const formattedResult = formatPaginatedResponse(result, page, limit);

        if (formattedResult.items) {
            formattedResult.items = formattedResult.items.map(normalizeOrder);
        }

        if (formattedResult && formattedResult.items && formattedResult.items.length > 0) {
            const firstOrder = formattedResult.items[0];
            console.log(`[Debug getOrders API] (Paginated) Sample Order Details:`, {
                id: firstOrder.id,
                orderId: firstOrder.orderId,
                returns: firstOrder.returns,
                user: firstOrder.user,
                firstItemVolume: firstOrder.items?.[0]?.variantInfo?.volume,
                firstItemVariantVolume: firstOrder.items?.[0]?.variant?.volume
            });
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders fetched successfully.", formattedResult);
    } catch (error) {
        console.error(`[Debug getOrders API] Error:`, error);
        logger.error(`[Get Orders Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get order details by ID
 * @route   GET /api/user/orders/:id
 * @access  Private
 */
export const getOrderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { paginate, page: queryPage, limit: queryLimit } = req.query;

        // Build the include array for OrderItem
        const orderItemInclude = [
            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
            {
                model: ProductVariant,
                as: 'variant',
                attributes: ['id', 'volume', 'image', 'extra'],
                include: [
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ]
            }
        ];

        // Backward compatibility: if page & limit are not provided (old app), return all items
        const shouldPaginateItems = (queryPage || queryLimit) && paginate !== 'false';

        let order;
        let orderData;
        if (shouldPaginateItems) {
            // Get order with paginated items
            const pagination = getPaginationOptions(req.query);
            const { limit, offset, page } = pagination;

            // First get the order without items to get order details
            order = await Order.findOne({
                where: { id, userId },
                include: [
                    { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                                include: [
                                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                                ]
                            }
                        ]
                    }
                ]
            });

            if (!order) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
            }

            // Get paginated items separately
            const itemsResult = await OrderItem.findAndCountAll({
                where: { orderId: order.id },
                include: orderItemInclude,
                limit,
                offset,
                order: [['createdAt', 'ASC']],
                distinct: true
            });

            orderData = normalizeOrder(order);

            // Format paginated items
            const formattedItems = itemsResult.rows.map(normalizeOrderItem);

            // Add paginated items to order data
            orderData.items = formattedItems;
            orderData.itemsPagination = {
                total: itemsResult.count,
                page,
                limit,
                totalPages: Math.ceil(itemsResult.count / limit)
            };

            if (orderData.orderDetails) {
                orderData.orderDetails.items = formattedItems;
                orderData.orderDetails.itemsPagination = orderData.itemsPagination;
            }
        } else {
            // Get order with all items (backward compatibility)
            order = await Order.findOne({
                where: { id, userId },
                include: [
                    { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
                    {
                        model: OrderItem,
                        as: 'items',
                        include: orderItemInclude
                    },
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                                include: [
                                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                                ]
                            }
                        ]
                    }
                ]
            });

            if (!order) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
            }

            orderData = normalizeOrder(order);
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", orderData);
    } catch (error) {
        logger.error(`[Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

export const getOrderDetailsV2 = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { paginate, page: queryPage, limit: queryLimit } = req.query;

        const orderItemInclude = [
            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
            {
                model: ProductVariant,
                as: 'variant',
                attributes: ['id', 'volume', 'image', 'extra'],
                include: [
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ]
            }
        ];

        const shouldPaginateItems = (queryPage || queryLimit) && paginate !== 'false';

        let order;
        let items = [];
        let itemsPagination = null;
        let orderData;

        if (shouldPaginateItems) {
            const pagination = getPaginationOptions(req.query);
            const { limit, offset, page } = pagination;

            order = await Order.findOne({
                where: { id, userId },
                include: [
                    { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                                include: [
                                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                                ]
                            }
                        ]
                    }
                ]
            });

            if (!order) {
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
            }

            const itemsResult = await OrderItem.findAndCountAll({
                where: { orderId: order.id },
                include: orderItemInclude,
                limit,
                offset,
                order: [['createdAt', 'ASC']],
                distinct: true
            });

            orderData = normalizeOrder(order);

            items = formatOrderItems(itemsResult.rows);
            itemsPagination = {
                total: itemsResult.count,
                page,
                limit,
                totalPages: Math.ceil(itemsResult.count / limit)
            };

            const orderDetails = { ...orderData, items, itemsPagination };
            if (orderDetails.orderDetails) {
                orderDetails.orderDetails.items = items;
                orderDetails.orderDetails.itemsPagination = itemsPagination;
            }

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", {
                ...orderData,
                orderDetails,
                items,
                itemsPagination
            });
        }

        order = await Order.findOne({
            where: { id, userId },
            include: [
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'email', 'city', 'postcode'] },
                {
                    model: OrderItem,
                    as: 'items',
                    include: orderItemInclude
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        orderData = normalizeOrder(order);
        items = formatOrderItems(orderData.items || []);

        const orderDetails = { ...orderData };
        if (orderDetails.orderDetails) {
            orderDetails.orderDetails.items = items;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", {
            ...orderData,
            orderDetails,
            items
        });
    } catch (error) {
        logger.error(`[Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Cancel an order
 * @route   PUT /api/user/orders/:id/cancel
 * @access  Private
 */
export const cancelOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
        const whereClause = { userId };
        if (isUuid) {
            whereClause.id = id;
        } else {
            whereClause.orderId = id;
        }

        const order = await Order.findOne({
            where: whereClause,
            include: [{ model: OrderItem, as: 'items' }]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const nonCancellableStatuses = ['Delivered', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'];
        if (nonCancellableStatuses.includes(order.orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Cannot cancel order that is already '${order.orderStatus}'.`);
        }

        const prevStatus = order.orderStatus;

        order.orderStatus = 'User Cancel';
        order.dueAmount = 0;
        order.notes = order.notes ? `${order.notes}\n[Customer Cancelled]` : `[Customer Cancelled]`;
        await order.save();

        // If the order was already shipped, convert cancel into Sales Return entries (Pending)
        // and DO NOT restore inventory until admin approves the sales return.
        if (prevStatus === 'Shipping') {
            // Create SalesReturn entries for all items and remove them from order items
            const assignment = await Order.sequelize.models.OrderAssignment?.findOne({ where: { orderId: order.id } });
            const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;

            let totalReturnAmount = 0;
            for (const item of order.items || []) {
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
                    reason: 'Cancelled after shipping',
                    status: 'Pending'
                });

                totalReturnAmount += returnAmount;

                // Remove the order item
                await OrderItem.destroy({ where: { id: item.id } });
            }

            // Recalculate order totals
            const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
            let newSubtotal = 0;
            for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
            order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
            order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
            await order.save();
        } else {
            // Restore stock for all items (existing behaviour)
            if (order.items && order.items.length > 0) {
                for (const item of order.items) {
                    const variant = await ProductVariant.findByPk(item.variantId, {
                        include: [{ model: Product, as: 'product' }]
                    });

                    if (variant?.product?.isCombo) {
                        const comboProducts = [
                            variant.product.comboProduct1Id,
                            variant.product.comboProduct2Id
                        ];
                        for (const cpId of comboProducts) {
                            const compVariant = await ProductVariant.findOne({
                                where: {
                                    productId: cpId,
                                    ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                                }
                            }) || await ProductVariant.findOne({
                                where: { productId: cpId }
                            });

                            if (!compVariant) continue;

                            const compBUPP = Number(compVariant.baseUnitsPerPack || 1);
                            const compSellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                            const baseUnitsToRestore = Math.round(item.sellUnit === 'Inner'
                                ? Number(item.quantity)
                                : Number(item.quantity) * compSellingVolume * compBUPP);

                            logger.info(`[Cancel Order Restore Combo]: comboProductId=${cpId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, compSellingVolume=${compSellingVolume}, compBUPP=${compBUPP}, restoring=${baseUnitsToRestore} base units`);

                            const stock = await InventoryStock.findOne({
                                where: { productId: cpId },
                                order: [['createdAt', 'DESC']]
                            });
                            if (stock) {
                                await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore });
                            }
                        }
                    } else {
                        const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                        const sellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = Math.round(item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * sellingVolume * bUPP);

                        logger.info(`[Cancel Order Restore]: productId=${item.productId}, qty=${item.quantity}, sellUnit=${item.sellUnit}, sellingVolume=${sellingVolume}, bUPP=${bUPP}, restoring=${baseUnitsToRestore} base units`);

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

        // Cancel associated assignment if exists
        const OrderAssignment = order.sequelize.models.OrderAssignment;
        if (OrderAssignment) {
            await OrderAssignment.update(
                { status: 'Cancelled', notes: 'Cancelled by Customer' },
                { where: { orderId: order.id } }
            );
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order cancelled successfully.", order);
    } catch (error) {
        logger.error(`[Cancel Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Initialize Razorpay Order
 * @route   POST /api/user/orders/razorpay/initialize
 * @access  Private
 */
export const initializeRazorpayOrder = async (req, res) => {
    try {
        const { amount } = req.body; // Amount in Rupees

        if (!amount || isNaN(amount) || amount <= 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid amount.");
        }

        // Fetch Razorpay Keys from AppSettings with environment fallback
        const settings = await AppSettings.findOne();
        const keyId = settings?.razorpayKeyId || process.env.RAZORPAY_KEY_ID;
        const secretKey = settings?.razorpaySecretKey || process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !secretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay is not configured in settings.");
        }

        const razorpay = new Razorpay({
            key_id: keyId,
            key_secret: secretKey,
        });

        const options = {
            amount: Math.round(amount * 100), // Razorpay expects amount in paise (Rupees * 100)
            currency: "INR",
            receipt: `receipt_${Date.now()}`,
        };

        const razorpayOrder = await razorpay.orders.create(options);

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Razorpay order initialized.", {
            id: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            keyId: keyId // Send Key ID to frontend for the Checkout SDK
        });
    } catch (error) {
        logger.error(`[Razorpay Initialize Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Verify Razorpay Payment Signature
 * @route   POST /api/user/orders/razorpay/verify
 * @access  Private
 */
export const verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Missing payment details.");
        }

        const settings = await AppSettings.findOne();
        const secretKey = settings?.razorpaySecretKey || process.env.RAZORPAY_KEY_SECRET;
        if (!secretKey) {
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "Razorpay secret key not found.");
        }

        const body = razorpayOrderId + "|" + razorpayPaymentId;
        const expectedSignature = crypto
            .createHmac("sha256", secretKey)
            .update(body.toString())
            .digest("hex");

        if (expectedSignature === razorpaySignature) {
            return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment verified successfully.", { verified: true });
        } else {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Invalid payment signature.");
        }
    } catch (error) {
        logger.error(`[Razorpay Verify Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get orders with payment status details for the user
 * @route   GET /api/user/orders/payment-status
 * @access  Private
 */
export const getOrdersWithPaymentStatus = async (req, res) => {
    try {
        const userId = req.user.id;

        const orders = await Order.findAll({
            where: { userId },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'extra'],
                            include: [
                                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                            ]
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        const updatedOrders = orders.map(o => {
            const orderData = o.toJSON ? o.toJSON() : o;
            if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
                orderData.orderStatus = 'Delivered';
            }
            if (orderData.items) {
                orderData.items = orderData.items.map(item => {
                    if (item.variant) {
                        item.variant.extraName = item.variant.extra || '';
                        item.variant.extra = item.variant.extra || '';
                    }
                    return item;
                });
            }
            return orderData;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment status data fetched successfully.", updatedOrders);
    } catch (error) {
        logger.error(`[Get Payment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
