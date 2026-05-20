import { Order, OrderItem, Product, ProductVariant, User, Volume, Cart, AppSettings, InventoryStock, InventoryTransaction, Godown, AdminNotification, ProductPricing } from '../../models/index.js';
import { emitAdminNotification } from '../../socket.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Generate a unique human-readable Order ID
 */
const generateUniqueOrderId = () => {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `ORD-${timestamp}${random}`;
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

        for (const item of items) {
            const { productId, variantId, quantity, sellUnit } = item;

            // 1. Fetch Product and Variant
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
            const deductionRequired = sellUnit === 'Inner'
                ? Number(quantity)
                : Number(quantity) * bUPP;

            let combo1Variant = null;
            let combo2Variant = null;
            if (variant.product?.isCombo) {
                // Find matching or default variant for Combo Product 1
                combo1Variant = await ProductVariant.findOne({
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
                combo2Variant = await ProductVariant.findOne({
                    where: { 
                        productId: variant.product.comboProduct2Id,
                        ...(variant.volumeId ? { volumeId: variant.volumeId } : {})
                    },
                    transaction: t
                }) || await ProductVariant.findOne({
                    where: { productId: variant.product.comboProduct2Id },
                    transaction: t
                });
            }

            if (variant.product?.isCombo) {
                if (!combo1Variant || !combo2Variant) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Combo components variants not found for this product.`);
                }

                const bUPP1 = Number(combo1Variant.baseUnitsPerPack || 1);
                const deduction1 = sellUnit === 'Inner' ? Number(quantity) : Number(quantity) * bUPP1;

                const bUPP2 = Number(combo2Variant.baseUnitsPerPack || 1);
                const deduction2 = sellUnit === 'Inner' ? Number(quantity) : Number(quantity) * bUPP2;

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
                    await t.rollback();
                    const prod1 = await Product.findByPk(variant.product.comboProduct1Id, { transaction: t });
                    const prod1Name = prod1?.name ? (prod1.name.en || Object.values(prod1.name)[0] || 'Product 1') : 'Product 1';
                    return sendErrorResponse(
                        res,
                        HTTP_STATUS.BAD_REQUEST,
                        `Insufficient stock for combo component: ${prod1Name}. Required: ${deduction1} units, Available: ${stock1} units.`
                    );
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
                    await t.rollback();
                    const prod2 = await Product.findByPk(variant.product.comboProduct2Id, { transaction: t });
                    const prod2Name = prod2?.name ? (prod2.name.en || Object.values(prod2.name)[0] || 'Product 2') : 'Product 2';
                    return sendErrorResponse(
                        res,
                        HTTP_STATUS.BAD_REQUEST,
                        `Insufficient stock for combo component: ${prod2Name}. Required: ${deduction2} units, Available: ${stock2} units.`
                    );
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
                    await t.rollback();
                    const productName = typeof variant.product?.name === 'object' 
                        ? (variant.product.name.en || Object.values(variant.product.name)[0] || 'Product') 
                        : (variant.product?.name || 'Product');
                    return sendErrorResponse(
                        res,
                        HTTP_STATUS.BAD_REQUEST,
                        `Insufficient stock for ${productName}. Required: ${deductionRequired} units, Available: ${availableStock} units.`
                    );
                }
            }

            // 2. Fetch all pricings for this variant
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

        const finalTotal = backendTotal;

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

        // 5. Create the Order
        const newOrder = await Order.create({
            orderId: generateUniqueOrderId(),
            userId,
            totalAmount: finalTotal,
            paidAmount: paymentStatus === 'Paid' ? finalTotal : 0,
            dueAmount: paymentStatus === 'Paid' ? 0 : finalTotal,
            paymentMethod,
            paymentStatus,
            orderStatus: 'Pending',
            deliveryMode,
            deliveryCharge
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
                        const compDeduction = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * compBUPP;

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
                    const deductionRequired = item.sellUnit === 'Inner'
                        ? item.quantity
                        : item.quantity * (variant.baseUnitsPerPack || 1);

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
            console.log('Creating AdminNotification for Order:', newOrder.orderId);
            const adminNotify = await AdminNotification.create({
                title: 'New Order Received!',
                message: `User ${userData.fullname} has placed a new order #${newOrder.orderId} of ₹${newOrder.totalAmount}.`,
                type: 'ORDER',
                referenceId: newOrder.id,
                clickAction: `/sales/user-orders`
            });
            console.log('AdminNotification created successfully:', adminNotify.id);
            emitAdminNotification(adminNotify);
        } catch (notifyErr) {
            console.error('[Admin Notification Error]:', notifyErr);
            logger.error(`[Admin Notification Error]: ${notifyErr.message}`);
        }

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Order placed successfully.", newOrder);
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
        const { id } = req.query; // Check if a specific ID is requested

        const where = { userId };
        if (id) {
            where.id = id;
        }

        const orders = await Order.findAll({
            where,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image'],
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
            return orderData;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Orders fetched successfully.", updatedOrders);
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

        const order = await Order.findOne({
            where: { id, userId },
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image'],
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

        const orderData = order.toJSON ? order.toJSON() : order;
        if (orderData.orderStatus === 'Payment Collect' || orderData.orderStatus === 'Payment Verify') {
            orderData.orderStatus = 'Delivered';
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Order details fetched successfully.", orderData);
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

        const nonCancellableStatuses = ['Delivered', 'Cancelled'];
        if (nonCancellableStatuses.includes(order.orderStatus)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Cannot cancel order that is already '${order.orderStatus}'.`);
        }

        order.orderStatus = 'Cancelled';
        order.notes = order.notes ? `${order.notes}\n[Customer Cancelled]` : `[Customer Cancelled]`;
        await order.save();

        // Restore stock for all items
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
                        const baseUnitsToRestore = item.sellUnit === 'Inner'
                            ? Number(item.quantity)
                            : Number(item.quantity) * compBUPP;

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
                    const baseUnitsToRestore = item.sellUnit === 'Inner' 
                        ? Number(item.quantity) 
                        : Number(item.quantity) * bUPP;

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
                            attributes: ['id', 'volume', 'image'],
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
            return orderData;
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Payment status data fetched successfully.", updatedOrders);
    } catch (error) {
        logger.error(`[Get Payment Status Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
