import { Order, OrderItem, Product, ProductVariant, User, Volume, Cart, AppSettings, InventoryStock, InventoryTransaction, Godown, AdminNotification, ProductPricing, SalesReturn, Notification, Admin, OrderBlockSetting } from '../../models/index.js';
import { emitAdminNotification, getIO } from '../../socket.js';
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
 * Generate a unique human-readable Order ID (100% bulletproof with uniqueness check)
 */
const generateUniqueOrderId = async () => {
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

const sendPushToAllAdmins = async (title, body, data = {}) => {
    try {
        const admins = await Admin.findAll({
            where: { status: 'Active', fcmtoken: { [Op.ne]: null } },
            attributes: ['fcmtoken']
        });
        const adminTokens = admins.flatMap(adm => {
            const tokenVal = adm.fcmtoken;
            if (!tokenVal) return [];
            const trimmed = tokenVal.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                try {
                    return JSON.parse(trimmed);
                } catch (e) {
                    return [trimmed];
                }
            }
            return [trimmed];
        });

        if (adminTokens.length > 0) {
            await sendToDevice(adminTokens, title, body, null, data);
        }
    } catch (err) {
        console.error('[Admin Push Notification Error]:', err);
    }
};

/**
 * @desc    Create a new order (Checkout)
 * @route   POST /api/user/orders
 * @access  Private
 */
export const createOrder = async (req, res) => {
    logger.info(`[Create Order] Started. Body: ${JSON.stringify(req.body)}, User: ${req.user?.id}`);

    // Check if order creation is paused/blocked due to emergency/maintenance
    try {
        const blockSetting = await OrderBlockSetting.findOne();
        if (blockSetting && blockSetting.isBlocked) {
            const now = new Date();
            let shouldBlock = false;

            if (blockSetting.fromDate && blockSetting.toDate) {
                const from = new Date(blockSetting.fromDate);
                const to = new Date(blockSetting.toDate);
                if (now >= from && now <= to) {
                    shouldBlock = true;
                }
            } else {
                // If no dates are specified but block is toggled, block immediately
                shouldBlock = true;
            }

            if (shouldBlock) {
                const defaultMsg = `Order creation is temporarily paused due to ${
                    blockSetting.type === 'Monsoon' ? 'monsoon conditions' : 'maintenance'
                }.`;
                const finalMsg = blockSetting.description || blockSetting.message || blockSetting.title || defaultMsg;
                return sendErrorResponse(
                    res, 
                    HTTP_STATUS.BAD_REQUEST, 
                    finalMsg
                );
            }
        }
    } catch (err) {
        logger.error(`[Create Order Block Check Error]: ${err.message}`);
    }

    const t = await sequelize.transaction();
    try {
        const {
            items,
            paymentMethod,
            deliveryMode,
            deliveryRoundId,
            deliveryRoundTiming,
            deliveryDate,
            totalAmount: frontendTotalAmount // Total sent from frontend for validation
        } = req.body;

        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        // Fetch User and target Godown at the beginning for stock validation
        const userData = await User.findByPk(userId, { transaction: t });
        logger.info(`[Create Order] User data fetched: ${userData ? userData.fullname : 'None'}`);
        if (!userData) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "User not found.");
        }

        let targetGodownId = userData.godownId || null;

        if (!targetGodownId) {
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
        }

        let calculatedSubtotal = 0;
        const orderItemsData = [];
        const outOfStockItems = [];

        // 1. Perform stock check for all items first
        for (const item of items) {
            const { productId, variantId, quantity } = item;
            const sellUnit = item.sellUnit || 'Base';

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
                let userGodownStock = 0;
                if (targetGodownId) {
                    const godownStockSum = await InventoryStock.sum('totalBaseUnits', {
                        where: {
                            productId: item.productId,
                            godownId: targetGodownId,
                            totalBaseUnits: { [Op.gt]: 0 }
                        },
                        transaction: t
                    });
                    userGodownStock = parseFloat(godownStockSum) || 0;
                    availableStock = userGodownStock;
                }

                console.log(`[CREATE_ORDER_STOCK_CHECK] Product: ${item.productId}, Variant: ${variant?.id}`);
                console.log(`  -> bUPP: ${bUPP}, requestedQty: ${item.quantity}, deductionRequiredBaseUnits: ${deductionRequired}`);
                console.log(`  -> godownId: ${targetGodownId}, availableStockInAssignedGodown: ${availableStock}`);
                console.log(`  -> oldStockLockToggle: ${variant?.oldStockLockToggle}, oldStockLimitQty: ${variant?.oldStockLimitQty}`);

                if (variant.oldStockLockToggle && Number(variant.oldStockLimitQty || 0) > 0) {
                    const limitQty = Number(variant.oldStockLimitQty);
                    const lockedBaseUnits = limitQty * bUPP;
                    console.log(`  -> Lock active in createOrder! lockedBaseUnits: ${lockedBaseUnits} (limit: ${limitQty} packs)`);
                    availableStock = Math.min(availableStock, lockedBaseUnits);
                    console.log(`  -> availableStock after lock cap: ${availableStock}`);
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
            const { productId, variantId, quantity } = item;
            const sellUnit = item.sellUnit || 'Base';

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
                    sellingVolume: variant.sellingVolume,
                    baseUnitsPerPack: variant.baseUnitsPerPack,
                    boxNumber: variant.product?.boxNumber || null
                }
            });
        }

        // 3. Calculate delivery charge and final total
        const settings = await AppSettings.findOne({ transaction: t });
        let resolvedDeliveryRoundTiming = deliveryRoundTiming;
        if (deliveryMode === 'Round' && deliveryRoundId && settings && Array.isArray(settings.deliveryRoundSchedules)) {
            const normalizedSchedules = settings.deliveryRoundSchedules.map((round, index) => ({
                id: round.id || `round_${index + 1}`,
                ...round
            }));
            const matchedRound = normalizedSchedules.find(r => r.id === deliveryRoundId);
            if (matchedRound) {
                resolvedDeliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
            }
        }

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

        logger.info(`[Create Order] Calculated subtotal: ${calculatedSubtotal}. Checking for existing pending order.`);
        // Check if there is an existing pending order for this user with matching delivery mode, round ID, and delivery date
        const existingOrder = await Order.findOne({
            where: { 
                userId, 
                orderStatus: 'Pending',
                deliveryMode: deliveryMode || null,
                deliveryRoundId: deliveryRoundId || null,
                deliveryDate: deliveryDate || null
            },
            transaction: t
        });

        let targetOrder = null;

        if (existingOrder) {
            logger.info(`[Create Order] Found existing pending order: ${existingOrder.id}. Merging items.`);
            targetOrder = existingOrder;

            // Merge items into the existing order
            for (const incomingItem of orderItemsData) {
                const { productId, variantId, quantity, price, sellUnit, variantInfo } = incomingItem;

                const matchedItem = await OrderItem.findOne({
                    where: { orderId: existingOrder.id, variantId, sellUnit },
                    transaction: t
                });

                if (matchedItem) {
                    const newQty = Number(matchedItem.quantity) + Number(quantity);
                    await matchedItem.update({ quantity: newQty }, { transaction: t });
                } else {
                    await OrderItem.create({
                        orderId: existingOrder.id,
                        productId,
                        variantId,
                        quantity,
                        price,
                        sellUnit,
                        variantInfo
                    }, { transaction: t });
                }
            }

            // Re-fetch all items in this order to calculate correct prices according to new total quantities (in case of pricing tiers)
            const allOrderItems = await OrderItem.findAll({
                where: { orderId: existingOrder.id },
                transaction: t
            });

            let mergedSubtotal = 0;
            for (const orderItem of allOrderItems) {
                const variant = await ProductVariant.findByPk(orderItem.variantId, { transaction: t });
                const bUPP = Number(variant.baseUnitsPerPack || 1);

                const pricings = await ProductPricing.findAll({
                    where: { variantId: orderItem.variantId },
                    order: [['minQty', 'ASC']]
                });

                let applicablePricing = pricings.find(p =>
                    p.customLevelId === userAppLevel &&
                    Number(orderItem.quantity) >= Number(p.minQty) &&
                    (p.maxQty === null || Number(orderItem.quantity) <= Number(p.maxQty))
                );
                if (!applicablePricing) {
                    applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
                }
                if (!applicablePricing && pricings.length > 0) {
                    applicablePricing = pricings[0];
                }

                let rawPrice = applicablePricing ? parseFloat(applicablePricing.price) : (parseFloat(variant.purchasePrice) || 0);
                const itemPrice = orderItem.sellUnit === 'Inner' ? (rawPrice / bUPP) : rawPrice;
                const itemSubtotal = itemPrice * parseFloat(orderItem.quantity);
                mergedSubtotal += itemSubtotal;

                await orderItem.update({ price: itemPrice }, { transaction: t });
            }

            // Recalculate delivery charge for the entire order
            let mergedDeliveryCharge = 0;
            if (settings && mergedSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
                if (deliveryMode === 'Express') mergedDeliveryCharge = parseFloat(settings.expressDeliveryCharge);
                else if (deliveryMode === 'Round') mergedDeliveryCharge = parseFloat(settings.deliveryOnRoundCharge);
            }

            const mergedTotal = roundTotal(mergedSubtotal + mergedDeliveryCharge);

            logger.info(`[Create Order] Updating existing order: ${existingOrder.id} with total: ${mergedTotal}`);
            // Update the existing order details
            await existingOrder.update({
                totalAmount: mergedTotal,
                dueAmount: mergedTotal,
                deliveryCharge: mergedDeliveryCharge,
                deliveryMode,
                deliveryRoundId,
                deliveryRoundTiming: resolvedDeliveryRoundTiming,
                deliveryDate: deliveryDate || null,
                isMerged: true
            }, { transaction: t });

        } else {
            logger.info(`[Create Order] Creating new order. totalAmount: ${finalTotal}, paymentMethod: ${paymentMethod}`);
            // Create a new Order
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
                deliveryRoundId,
                deliveryRoundTiming: resolvedDeliveryRoundTiming,
                deliveryDate: deliveryDate || null,
                routeCategoryId: userData.routeCategoryId || null,
                godownId: targetGodownId,
            }, { transaction: t });

            targetOrder = newOrder;

            logger.info(`[Create Order] New order created: ${newOrder.id}. Creating order items.`);
            // Create Order Items
            const finalOrderItems = orderItemsData.map(item => ({
                ...item,
                orderId: newOrder.id
            }));

            await OrderItem.bulkCreate(finalOrderItems, { transaction: t });
        }

        logger.info(`[Create Order] Order saved. Clearing cart for user: ${userId}`);
        // 7. Clear Cart
        await Cart.destroy({ where: { userId }, transaction: t });

        logger.info(`[Create Order] Cart cleared. Deducting stock from Godown: ${targetGodownId}`);
        // 8. Deduct Stock from Inventory
        if (targetGodownId) {
            for (const item of orderItemsData) {
                const variant = await ProductVariant.findByPk(item.variantId, {
                    include: [{ model: Product, as: 'product' }],
                    transaction: t
                });
                if (!variant) continue;

                // Process Old Stock Lock Toggle deduction & auto-activation of new pricings
                if (variant.oldStockLockToggle) {
                    const bUPP = Number(variant.baseUnitsPerPack || 1);
                    const purchasedPacks = item.sellUnit === 'Inner'
                        ? (Number(item.quantity) / bUPP)
                        : Number(item.quantity);

                    const currentLimit = Number(variant.oldStockLimitQty || 0);
                    const newLimit = currentLimit - purchasedPacks;

                    if (newLimit <= 0) {
                        const newPricings = variant.newPricingData;
                        if (newPricings && Array.isArray(newPricings) && newPricings.length > 0) {
                            await ProductPricing.destroy({
                                where: { variantId: variant.id },
                                transaction: t
                            });

                            for (const p of newPricings) {
                                await ProductPricing.create({
                                    variantId: variant.id,
                                    customLevelId: p.customLevelId,
                                    quantityRange: `${p.minQty}-${p.maxQty}`,
                                    minQty: p.minQty,
                                    maxQty: p.maxQty,
                                    purchasePrice: variant.purchasePrice,
                                    price: p.price,
                                    mrp: p.mrp,
                                    status: 'Active'
                                }, { transaction: t });
                            }
                        }

                        await variant.update({
                            oldStockLockToggle: false,
                            oldStockLimitQty: 0,
                            newPricingData: null
                        }, { transaction: t });
                    } else {
                        await variant.update({
                            oldStockLimitQty: newLimit
                        }, { transaction: t });
                    }
                }

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
                                note: `Sales Order #${targetOrder.orderId} (Combo Component)`,
                                createdBy: req.user?.fullname || 'Customer'
                            }, { transaction: t });

                            remainingToDeduct -= deductFromThis;
                        }

                        if (remainingToDeduct > 0) {
                            logger.warn(`[Stock Deduction Shortfall]: Order #${targetOrder.orderId} - Shortfall of ${remainingToDeduct} base units for combo component variant ${compVariant.id} in Godown ${targetGodownId}`);
                        }
                    }
                } else {
                    // NORMAL PRODUCT STOCK DEDUCTION
                    const deductionRequired = Math.round(item.sellUnit === 'Inner'
                        ? Number(item.quantity)
                        : Number(item.quantity) * (variant.baseUnitsPerPack || 1));

                    // First try target godown, then fallback to any godown with stock (FIFO)
                    let stocks = [];
                    if (targetGodownId) {
                        stocks = await InventoryStock.findAll({
                            where: {
                                productId: item.productId,
                                godownId: targetGodownId,
                                totalBaseUnits: { [Op.gt]: 0 }
                            },
                            order: [['createdAt', 'ASC']],
                            transaction: t
                        });
                    }

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
                            godownId: stock.godownId,
                            type: 'SALE',
                            primaryUnitId: stock.primaryUnitId,
                            secondaryUnitId: stock.secondaryUnitId,
                            secondaryPerPrimary: stock.secondaryPerPrimary,
                            totalQtyBaseUnits: deductFromThis,
                            balanceAfterBaseUnits: newTotalBaseUnits,
                            note: `Sales Order #${targetOrder.orderId}`,
                            createdBy: req.user?.fullname || 'Customer'
                        }, { transaction: t });

                        remainingToDeduct -= deductFromThis;
                    }

                    // Fallback to any godown if target godown didn't have enough base units
                    if (remainingToDeduct > 0) {
                        const fallbackStocks = await InventoryStock.findAll({
                            where: {
                                productId: item.productId,
                                totalBaseUnits: { [Op.gt]: 0 }
                            },
                            order: [['createdAt', 'ASC']],
                            transaction: t
                        });

                        for (const stock of fallbackStocks) {
                            if (remainingToDeduct <= 0) break;

                            const deductFromThis = Math.min(stock.totalBaseUnits, remainingToDeduct);
                            const newTotalBaseUnits = stock.totalBaseUnits - deductFromThis;

                            await stock.update({ totalBaseUnits: newTotalBaseUnits }, { transaction: t });

                            await InventoryTransaction.create({
                                stockId: stock.id,
                                productId: item.productId,
                                variantId: item.variantId,
                                godownId: stock.godownId,
                                type: 'SALE',
                                primaryUnitId: stock.primaryUnitId,
                                secondaryUnitId: stock.secondaryUnitId,
                                secondaryPerPrimary: stock.secondaryPerPrimary,
                                totalQtyBaseUnits: deductFromThis,
                                balanceAfterBaseUnits: newTotalBaseUnits,
                                note: `Sales Order #${targetOrder.orderId}`,
                                createdBy: req.user?.fullname || 'Customer'
                            }, { transaction: t });

                            remainingToDeduct -= deductFromThis;
                        }
                    }

                    if (remainingToDeduct > 0) {
                        logger.warn(`[Stock Deduction]: Order #${targetOrder.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId} in Godown ${targetGodownId}`);
                    }
                }
            }
        } else {
            logger.error(`[Stock Deduction]: No Godown found to deduct stock for Order #${targetOrder.orderId}`);
        }

        logger.info(`[Create Order] Stock deducted successfully. Committing transaction.`);
        await t.commit();
        logger.info(`[Create Order] Transaction committed successfully.`);

        // 9. Trigger Admin Notification (Real-time)
        try {
            const adminNotify = await AdminNotification.create({
                title: existingOrder ? 'Order Merged!' : 'New Order Received!',
                message: existingOrder 
                    ? `User ${userData.fullname} has updated pending order #${targetOrder.orderId} to ₹${targetOrder.totalAmount}.`
                    : `User ${userData.fullname} has placed a new order #${targetOrder.orderId} of ₹${targetOrder.totalAmount}.`,
                type: existingOrder ? 'ORDER_MERGE' : 'ORDER',
                referenceId: targetOrder.id,
                clickAction: `/sales/user-orders`
            });
            emitAdminNotification(adminNotify);
            
            // Send push notification to all active admins
            const adminTitle = existingOrder ? 'Order Merged' : 'New Order Received';
            const adminBody = existingOrder 
                ? `User ${userData.fullname} has updated pending order #${targetOrder.orderId} to ₹${targetOrder.totalAmount}.`
                : `User ${userData.fullname} has placed a new order #${targetOrder.orderId} of ₹${targetOrder.totalAmount}.`;
            await sendPushToAllAdmins(adminTitle, adminBody, { type: existingOrder ? 'order_merge' : 'order', id: String(targetOrder.id), orderId: String(targetOrder.id) });
        } catch (notifyErr) {
            console.error('[Admin Notification Error]:', notifyErr);
            logger.error(`[Admin Notification Error]: ${notifyErr.message}`);
        }

        // 10. Trigger User Push Notification
        try {
            if (userData.fcmtoken) {
                const userTitle = existingOrder ? 'Order Updated!' : 'Your Order Successful!';
                const userBody = existingOrder
                    ? `Hey ${userData.fullname}, your pending order #${targetOrder.orderId} has been updated to ₹${targetOrder.totalAmount} successfully!`
                    : `Hey ${userData.fullname}, your order #${targetOrder.orderId} of ₹${targetOrder.totalAmount} has been placed successfully!`;
                // Use type: 'order' so that it plays the custom orderDetails notification sound/channel
                await sendToDevice(userData.fcmtoken, userTitle, userBody, null, { type: 'order', id: String(targetOrder.id), orderId: String(targetOrder.id) });
                await Notification.create({
                    title: userTitle,
                    body: userBody,
                    type: 'ORDER',
                    target: String(targetOrder.userId),
                    status: 'SENT',
                    clickAction: String(targetOrder.id)
                });
            }
        } catch (pushErr) {
            console.error('[User Push Notification Error]:', pushErr);
            logger.error(`[User Push Notification Error]: ${pushErr.message}`);
        }

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, existingOrder ? "Order updated successfully." : "Order placed successfully.", targetOrder);
    } catch (error) {
        logger.error(`[Create Order Error Catch]: ${error.message}`);
        logger.error(error.stack || error);
        if (error.errors) {
            logger.error(`[Create Order Detailed Errors]: ${JSON.stringify(error.errors)}`);
        }
        if (t) {
            try {
                await t.rollback();
                logger.info(`[Create Order] Transaction rolled back.`);
            } catch (rollbackErr) {
                logger.error(`[Create Order] Rollback failed: ${rollbackErr.message}`);
            }
        }
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * Helper to populate delivery time round data from AppSettings if order uses Round mode.
 */
const populateDeliveryRound = async (orderData) => {
    if (!orderData) return orderData;

    // Ensure fields exist
    orderData.deliveryMode = orderData.deliveryMode || null;
    orderData.deliveryRoundId = orderData.deliveryRoundId || null;
    orderData.deliveryRoundTiming = orderData.deliveryRoundTiming || null;

    if (orderData.deliveryMode === 'Round' && orderData.deliveryRoundId) {
        try {
            const settings = await AppSettings.findOne();
            if (settings && Array.isArray(settings.deliveryRoundSchedules)) {
                const normalizedSchedules = settings.deliveryRoundSchedules.map((round, index) => ({
                    id: round.id || `round_${index + 1}`,
                    ...round
                }));
                const matchedRound = normalizedSchedules.find(r => r.id === orderData.deliveryRoundId);
                if (matchedRound) {
                    orderData.deliveryRound = {
                        id: matchedRound.id || orderData.deliveryRoundId,
                        name: matchedRound.name || '',
                        start: matchedRound.start || '',
                        end: matchedRound.end || ''
                    };
                    if (!orderData.deliveryRoundTiming) {
                        orderData.deliveryRoundTiming = matchedRound.time || `${matchedRound.start || ''} - ${matchedRound.end || ''}`;
                    }
                } else {
                    orderData.deliveryRound = null;
                }
            } else {
                orderData.deliveryRound = null;
            }
        } catch (err) {
            logger.error(`[Populate Delivery Round Error]: ${err.message}`);
            orderData.deliveryRound = null;
        }
    } else {
        orderData.deliveryRound = null;
    }

    return orderData;
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

        const where = { userId };
        if (id) {
            where.id = id;
        }

        const include = [
            {
                model: OrderItem,
                as: 'items',
                include: [
                    { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
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
                    { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'baseUnitsPerPack', 'sellingVolume'],
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

            const updatedOrders = await Promise.all(orders.map(async o => {
                let orderData = o.toJSON ? o.toJSON() : o;
                orderData.totalAmount = roundTotal(orderData.totalAmount);
                orderData.dueAmount = roundTotal(orderData.dueAmount);
                orderData.paidAmount = roundTotal(orderData.paidAmount);
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
                return await populateDeliveryRound(orderData);
            }));

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

        const formattedResult = formatPaginatedResponse(result, page, limit);

        if (formattedResult.data) {
            formattedResult.data = await Promise.all(formattedResult.data.map(async o => {
                let orderData = o.toJSON ? o.toJSON() : o;
                orderData.totalAmount = roundTotal(orderData.totalAmount);
                orderData.dueAmount = roundTotal(orderData.dueAmount);
                orderData.paidAmount = roundTotal(orderData.paidAmount);
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
                return await populateDeliveryRound(orderData);
            }));
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders fetched successfully.", formattedResult);
    } catch (error) {
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
            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
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
        if (shouldPaginateItems) {
            // Get order with paginated items
            const pagination = getPaginationOptions(req.query);
            const { limit, offset, page } = pagination;

            // First get the order without items to get order details
            order = await Order.findOne({
                where: { id, userId },
                include: [
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'baseUnitsPerPack', 'sellingVolume'],
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

            let orderData = order.toJSON ? order.toJSON() : order;
            orderData.totalAmount = roundTotal(orderData.totalAmount);
            orderData.dueAmount = roundTotal(orderData.dueAmount);
            orderData.paidAmount = roundTotal(orderData.paidAmount);
            if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
                orderData.orderStatus = 'Delivered';
            }
            orderData = await populateDeliveryRound(orderData);

            // Format paginated items
            const formattedItems = itemsResult.rows.map(item => {
                const itemData = item.toJSON ? item.toJSON() : item;
                if (itemData.variant) {
                    itemData.variant.extraName = itemData.variant.extra || '';
                    itemData.variant.extra = itemData.variant.extra || '';
                }
                return itemData;
            });

            // Add paginated items to order data
            orderData.items = formattedItems;
            orderData.itemsPagination = {
                total: itemsResult.count,
                page,
                limit,
                totalPages: Math.ceil(itemsResult.count / limit)
            };
        } else {
            // Get order with all items (backward compatibility)
            order = await Order.findOne({
                where: { id, userId },
                include: [
                    {
                        model: OrderItem,
                        as: 'items',
                        include: orderItemInclude
                    },
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'baseUnitsPerPack', 'sellingVolume'],
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

            let orderData = order.toJSON ? order.toJSON() : order;
            orderData.totalAmount = roundTotal(orderData.totalAmount);
            orderData.dueAmount = roundTotal(orderData.dueAmount);
            orderData.paidAmount = roundTotal(orderData.paidAmount);
            if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
                orderData.orderStatus = 'Delivered';
            }
            orderData = await populateDeliveryRound(orderData);
            if (orderData.items) {
                orderData.items = orderData.items.map(item => {
                    if (item.variant) {
                        item.variant.extraName = item.variant.extra || '';
                        item.variant.extra = item.variant.extra || '';
                    }
                    return item;
                });
            }
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", orderData);
    } catch (error) {
        logger.error(`[Get Order Details Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

const normalizeOrderItem = (item) => {
    const itemData = item.toJSON ? item.toJSON() : item;
    if (itemData.variant) {
        itemData.variant.extraName = itemData.variant.extra || '';
        itemData.variant.extra = itemData.variant.extra || '';
    }
    return itemData;
};

const formatOrderItems = (items) => {
    return (items || []).map(normalizeOrderItem);
};

export const getOrderDetailsV2 = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { paginate, page: queryPage, limit: queryLimit } = req.query;

        const orderItemInclude = [
            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
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

        if (shouldPaginateItems) {
            const pagination = getPaginationOptions(req.query);
            const { limit, offset, page } = pagination;

            order = await Order.findOne({
                where: { id, userId },
                include: [
                    {
                        model: SalesReturn,
                        as: 'returns',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'baseUnitsPerPack', 'sellingVolume'],
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

            let orderData = order.toJSON ? order.toJSON() : order;
            orderData.totalAmount = roundTotal(orderData.totalAmount);
            orderData.dueAmount = roundTotal(orderData.dueAmount);
            orderData.paidAmount = roundTotal(orderData.paidAmount);
            if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
                orderData.orderStatus = 'Delivered';
            }
            orderData = await populateDeliveryRound(orderData);

            items = formatOrderItems(itemsResult.rows);
            itemsPagination = {
                total: itemsResult.count,
                page,
                limit,
                totalPages: Math.ceil(itemsResult.count / limit)
            };

            const orderDetails = { ...orderData };
            delete orderDetails.items;
            delete orderDetails.itemsPagination;

            return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", {
                orderDetails,
                items,
                itemsPagination
            });
        }

        order = await Order.findOne({
            where: { id, userId },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: orderItemInclude
                },
                {
                    model: SalesReturn,
                    as: 'returns',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId', 'baseUnitsPerPack', 'sellingVolume'],
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

        let orderData = order.toJSON ? order.toJSON() : order;
        orderData.totalAmount = roundTotal(orderData.totalAmount);
        orderData.dueAmount = roundTotal(orderData.dueAmount);
        orderData.paidAmount = roundTotal(orderData.paidAmount);
        if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
            orderData.orderStatus = 'Delivered';
        }
        orderData = await populateDeliveryRound(orderData);

        items = formatOrderItems(orderData.items || []);

        const orderDetails = { ...orderData };
        delete orderDetails.items;

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", {
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
        if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Partial') {
            order.paymentStatus = 'Refunded';
        } else {
            order.paymentStatus = 'Failed';
        }
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

        // Emit Admin Notification (Real-time)
        try {
            // Emit a direct socket event so the admin panel table refreshes,
            // without sending any notification to the admin dropdown or playing a sound.
            const io = getIO();
            if (io) {
                io.to('admin_notifications').emit('order_updated', { id: order.id, status: 'Cancelled' });
            }
        } catch (notifyErr) {
            logger.error(`[Cancel Order Socket Error]: ${notifyErr.message}`);
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
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
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

/**
 * @desc    Update a pending order (add/remove/modify items)
 * @route   PUT /api/user/orders/:id
 * @access  Private
 */
export const updateOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const id = req.params.id || req.body.orderId || req.body.id;
        const { items } = req.body; // Array of { productId, variantId, quantity, sellUnit }
        const userId = req.user.id;
        const userAppLevel = req.user.applevel;

        if (!id) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide orderId or id.");
        }

        if (!items || !Array.isArray(items)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Please provide items array.");
        }

        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
        const whereClause = { userId };
        if (isUuid) {
            whereClause.id = id;
        } else {
            whereClause.orderId = id;
        }

        const order = await Order.findOne({
            where: whereClause,
            include: [{ model: OrderItem, as: 'items' }],
            transaction: t
        });

        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        if (order.orderStatus !== 'Pending') {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Only 'Pending' orders can be updated. This order is '${order.orderStatus}'.`);
        }

        // Fetch User and target Godown for stock check
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

        if (!targetGodownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "No fulfillment center found to check stock.");
        }

        // 1. Temporarily RESTORE stock of all OLD items of this order so we check stock correctly
        if (order.items && order.items.length > 0) {
            for (const item of order.items) {
                const variant = await ProductVariant.findByPk(item.variantId, {
                    include: [{ model: Product, as: 'product' }],
                    transaction: t
                });
                if (!variant) continue;

                if (variant.product?.isCombo) {
                    const comboProducts = [
                        variant.product.comboProduct1Id,
                        variant.product.comboProduct2Id
                    ];
                    for (const cpId of comboProducts) {
                        const compVariant = await ProductVariant.findOne({
                            where: { 
                                productId: cpId,
                                ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                            },
                            transaction: t
                        }) || await ProductVariant.findOne({
                            where: { productId: cpId },
                            transaction: t
                        });

                        if (!compVariant) continue;

                        const compBUPP = Number(compVariant.baseUnitsPerPack || 1);
                        const compSellingVolume = Number(variant?.sellingVolume || item.variantInfo?.sellingVolume || 1);
                        const baseUnitsToRestore = Math.round(item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * compSellingVolume * compBUPP);

                        const stock = await InventoryStock.findOne({
                            where: { productId: cpId, godownId: targetGodownId },
                            order: [['createdAt', 'DESC']],
                            transaction: t
                        }) || await InventoryStock.findOne({
                            where: { productId: cpId },
                            order: [['createdAt', 'DESC']],
                            transaction: t
                        });

                        if (stock) {
                            await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore }, { transaction: t });
                        }
                    }
                } else {
                    const bUPP = Number(variant.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                    const sellingVolume = Number(variant.sellingVolume || item.variantInfo?.sellingVolume || 1);
                    const baseUnitsToRestore = Math.round(item.sellUnit === 'Inner' 
                        ? Number(item.quantity) 
                        : Number(item.quantity) * sellingVolume * bUPP);

                    const stock = await InventoryStock.findOne({
                        where: { productId: item.productId, godownId: targetGodownId },
                        order: [['createdAt', 'DESC']],
                        transaction: t
                    }) || await InventoryStock.findOne({
                        where: { productId: item.productId },
                        order: [['createdAt', 'DESC']],
                        transaction: t
                    });

                    if (stock) {
                        await stock.update({ totalBaseUnits: Number(stock.totalBaseUnits) + baseUnitsToRestore }, { transaction: t });
                    }
                }
            }
        }

        // 2. Perform stock check for all NEW items
        const outOfStockItems = [];
        for (const item of items) {
            const { productId, variantId, quantity } = item;
            const sellUnit = item.sellUnit || 'Base';

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
            const deductionRequired = Math.round(sellUnit === 'Inner'
                ? Number(quantity)
                : Number(quantity) * bUPP);

            if (variant.product?.isCombo) {
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

                const stock1 = await InventoryStock.sum('totalBaseUnits', {
                    where: {
                        productId: variant.product.comboProduct1Id,
                        godownId: targetGodownId,
                        totalBaseUnits: { [Op.gt]: 0 }
                    },
                    transaction: t
                }) || 0;

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

                const stock2 = await InventoryStock.sum('totalBaseUnits', {
                    where: {
                        productId: variant.product.comboProduct2Id,
                        godownId: targetGodownId,
                        totalBaseUnits: { [Op.gt]: 0 }
                    },
                    transaction: t
                }) || 0;

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
                const totalStock = await InventoryStock.sum('totalBaseUnits', {
                    where: {
                        productId: item.productId,
                        godownId: targetGodownId,
                        totalBaseUnits: { [Op.gt]: 0 }
                    },
                    transaction: t
                }) || 0;

                const availableStock = parseFloat(totalStock);
                if (deductionRequired > availableStock) {
                    const productName = typeof variant.product?.name === 'object'
                        ? (variant.product.name.en || Object.values(variant.product.name)[0] || 'Product')
                        : (variant.product?.name || 'Product');

                    const unitLabel = sellUnit === 'Inner'
                        ? (variant.innerUnitRef?.name ? (Object.values(variant.innerUnitRef.name)[0] || variant.innerUnitLabel || 'Unit') : (variant.innerUnitLabel || 'Unit'))
                        : (variant.baseUnitRef?.name ? (Object.values(variant.baseUnitRef.name)[0] || variant.baseUnitLabel || 'Pack') : (variant.baseUnitLabel || 'Pack'));

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

        if (outOfStockItems.length > 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Insufficient stock for some products.", { outOfStockItems });
        }

        // 3. Delete old order items
        await OrderItem.destroy({
            where: { orderId: order.id },
            transaction: t
        });

        // 4. Create new order items & calculate pricing
        let calculatedSubtotal = 0;
        const newOrderItemsData = [];

        for (const item of items) {
            const { productId, variantId, quantity } = item;
            const sellUnit = item.sellUnit || 'Base';

            const variant = await ProductVariant.findByPk(variantId, {
                include: [
                    { model: Product, as: 'product' },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] }
                ],
                transaction: t
            });

            const bUPP = Number(variant.baseUnitsPerPack || 1);
            const pricings = await ProductPricing.findAll({
                where: { variantId },
                order: [['minQty', 'ASC']],
                transaction: t
            });

            let applicablePricing = pricings.find(p =>
                p.customLevelId === userAppLevel &&
                quantity >= Number(p.minQty) &&
                (p.maxQty === null || quantity <= Number(p.maxQty))
            );

            if (!applicablePricing) {
                applicablePricing = pricings.find(p => p.customLevelId === userAppLevel);
            }
            if (!applicablePricing && pricings.length > 0) {
                applicablePricing = pricings[0];
            }

            let rawPrice = applicablePricing ? parseFloat(applicablePricing.price) : (parseFloat(variant.purchasePrice) || 0);
            const itemPrice = sellUnit === 'Inner' ? (rawPrice / bUPP) : rawPrice;
            const itemSubtotal = itemPrice * parseFloat(quantity);
            calculatedSubtotal += itemSubtotal;

            newOrderItemsData.push({
                orderId: order.id,
                productId,
                variantId,
                quantity,
                price: itemPrice,
                sellUnit,
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
                    sellingVolume: variant.sellingVolume,
                    baseUnitsPerPack: variant.baseUnitsPerPack,
                    boxNumber: variant.product?.boxNumber || null
                }
            });
        }

        await OrderItem.bulkCreate(newOrderItemsData, { transaction: t });

        // 5. Deduct new stock
        for (const item of newOrderItemsData) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                include: [{ model: Product, as: 'product' }],
                transaction: t
            });
            if (!variant) continue;

            if (variant.product?.isCombo) {
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
                            note: `Sales Order #${order.orderId} (Updated Combo Component)`,
                            createdBy: req.user?.fullname || 'Customer'
                        }, { transaction: t });

                        remainingToDeduct -= deductFromThis;
                    }
                }
            } else {
                const bUPP = Number(variant.baseUnitsPerPack || 1);
                const deductionRequired = Math.round(item.sellUnit === 'Inner'
                    ? Number(item.quantity)
                    : Number(item.quantity) * bUPP);

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
                        note: `Sales Order #${order.orderId} (Updated)`,
                        createdBy: req.user?.fullname || 'Customer'
                    }, { transaction: t });

                    remainingToDeduct -= deductFromThis;
                }
            }
        }

        // 6. Recalculate delivery charges & update order totals
        const settings = await AppSettings.findOne({ transaction: t });
        let deliveryCharge = 0;
        if (settings && calculatedSubtotal < parseFloat(settings.freeDeliveryThreshold)) {
            if (order.deliveryMode === 'Express') deliveryCharge = parseFloat(settings.expressDeliveryCharge);
            else if (order.deliveryMode === 'Round') deliveryCharge = parseFloat(settings.deliveryOnRoundCharge);
        }

        const newTotal = roundTotal(calculatedSubtotal + deliveryCharge);

        await order.update({
            totalAmount: newTotal,
            dueAmount: newTotal, // Assuming payment is pending (Outstanding baki)
            deliveryCharge: deliveryCharge,
            notes: order.notes ? `${order.notes}\n[Updated by Customer]` : `[Updated by Customer]`
        }, { transaction: t });

        await t.commit();

        // 7. Trigger Admin Notification (Real-time)
        try {
            const adminNotify = await AdminNotification.create({
                title: 'Order Updated by User!',
                message: `User ${userData.fullname} has updated pending order #${order.orderId} to ₹${newTotal}.`,
                type: 'ORDER',
                referenceId: order.id,
                clickAction: `/sales/user-orders`
            });
            emitAdminNotification(adminNotify);
            
            // Send push notification to all active admins
            await sendPushToAllAdmins('Order Updated by User!', `User ${userData.fullname} has updated pending order #${order.orderId} to ₹${newTotal}.`, { type: 'order', id: String(order.id), orderId: String(order.id) });
        } catch (notifyErr) {
            console.error('[Admin Notification Error]:', notifyErr);
        }

        // 8. Trigger User Push Notification
        try {
            if (userData.fcmtoken) {
                const userTitle = 'Order Updated!';
                const userBody = `Hey ${userData.fullname}, your pending order #${order.orderId} has been updated to ₹${newTotal} successfully!`;
                await sendToDevice(userData.fcmtoken, userTitle, userBody, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
                await Notification.create({
                    title: userTitle,
                    body: userBody,
                    type: 'ORDER',
                    target: String(order.userId),
                    status: 'SENT',
                    clickAction: String(order.id)
                });
            }
        } catch (pushErr) {
            console.error('[User Push Notification Error]:', pushErr);
        }

        // Fetch updated order to return in response
        const updatedOrder = await Order.findOne({
            where: { id: order.id },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'boxNumber'] },
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

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order updated successfully.", updatedOrder);

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Update Order Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
