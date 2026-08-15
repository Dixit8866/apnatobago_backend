import { OutletOrder, OutletOrderItem, Product, ProductVariant, User, Volume, InventoryStock, InventoryTransaction, Godown } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

/**
 * Generate a unique human-readable Order ID for Outlet Orders (e.g. OTL-100001)
 */
const generateUniqueOutletOrderId = async () => {
    let nextId = 100001;
    const lastOrder = await OutletOrder.findOne({
        order: [['createdAt', 'DESC']],
        attributes: ['orderId'],
        paranoid: false
    });

    if (lastOrder && lastOrder.orderId) {
        const parts = lastOrder.orderId.split('-');
        const lastNum = parts.length > 1 ? Number(parts[1]) : Number(lastOrder.orderId);
        if (Number.isFinite(lastNum) && lastNum >= 100000) {
            nextId = lastNum + 1;
        }
    }

    let unique = false;
    let candidate = `OTL-${nextId}`;
    while (!unique) {
        const existing = await OutletOrder.findOne({
            where: { orderId: candidate },
            paranoid: false,
            attributes: ['id']
        });
        if (!existing) {
            unique = true;
        } else {
            nextId++;
            candidate = `OTL-${nextId}`;
        }
    }

    return candidate;
};

/**
 * @desc    Create a new Outlet Order
 * @route   POST /api/admin/outlet-orders
 * @access  Private (Admin)
 */
export const createOutletOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const {
            userId,
            customerName,
            customerPhone,
            shopName,
            godownId,
            items,
            paidAmount = 0,
            paymentMode = 'Cash',
            payments = [],
            deliveryDate = null,
            fulfillmentMode = 'Outlet',
            orderStatus = 'Completed',
            note = '',
            discountAmount = 0
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please add at least one item to the outlet order.');
        }

        // Compulsory Multiple Payments Validation
        if (!payments || !Array.isArray(payments) || payments.length === 0 || !payments.some(p => Number(p.amount) > 0)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'ચુકવણીની રીત (Multiple Payments) અને રકમ ભરવી ફરજિયાત છે. (Multiple Payments selection and valid amount are compulsory)');
        }

        let userObj = null;
        if (userId) {
            userObj = await User.findByPk(userId, { transaction: t });
        }

        const targetGodownId = godownId || userObj?.godownId;
        if (!targetGodownId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please select a valid Godown for stock deduction.');
        }

        const generatedOrderId = await generateUniqueOutletOrderId();

        let totalOrderAmount = 0;
        const processedItems = [];

        // 1. Process & Validate Items
        for (const item of items) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                include: [{ model: Product, as: 'product' }],
                transaction: t
            });

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Variant not found for item ${item.productId}`);
            }

            const itemQty = Number(item.quantity || 1);
            const itemUnitPrice = Number(item.price || variant.purchasePrice || 0);
            const itemDiscount = Number(item.discount || 0);
            const itemSubtotal = Math.max(0, (itemQty * itemUnitPrice) - itemDiscount);

            totalOrderAmount += itemSubtotal;

            const variantSnapshot = {
                id: variant.id,
                volume: variant.volume,
                extra: variant.extra,
                purchasePrice: variant.purchasePrice,
                baseUnitsPerPack: variant.baseUnitsPerPack,
                baseUnitLabel: variant.baseUnitLabel,
                innerUnitLabel: variant.innerUnitLabel,
                sellingVolume: variant.sellingVolume,
                productName: variant.product?.name,
                boxNumber: variant.product?.boxNumber
            };

            processedItems.push({
                productId: variant.productId,
                variantId: variant.id,
                quantity: itemQty,
                price: itemUnitPrice,
                sellUnit: item.sellUnit || 'Base',
                discount: itemDiscount,
                subtotal: itemSubtotal,
                variantInfo: variantSnapshot,
                variant
            });
        }

        const finalGrandTotal = Math.max(0, totalOrderAmount - Number(discountAmount || 0));
        
        // Sum total paid from payments array
        const numPaidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

        let paymentStatus = 'Pending';
        if (numPaidAmount >= finalGrandTotal && finalGrandTotal > 0) {
            paymentStatus = 'Paid';
        } else if (numPaidAmount > 0) {
            paymentStatus = 'Partial';
        }

        const finalCustomerName = (customerName && customerName.trim()) ? customerName.trim() : (userObj?.fullname || 'Guest');
        const finalCustomerPhone = customerPhone || userObj?.number || '';
        const finalShopName = shopName || userObj?.shopName || 'Direct Outlet';

        // Primary payment mode label
        const primaryMode = payments.length > 1 ? 'Multiple' : (payments[0]?.method || paymentMode || 'Cash');

        // 2. Create OutletOrder record
        const newOutletOrder = await OutletOrder.create({
            orderId: generatedOrderId,
            userId: userId || null,
            customerName: finalCustomerName,
            customerPhone: finalCustomerPhone,
            shopName: finalShopName,
            godownId: targetGodownId,
            orderStatus: orderStatus || 'Completed',
            fulfillmentStatus: 'Fulfilled',
            paymentStatus,
            totalAmount: totalOrderAmount,
            discountAmount: Number(discountAmount || 0),
            grandTotal: finalGrandTotal,
            paidAmount: numPaidAmount,
            paymentMode: primaryMode,
            payments: payments,
            deliveryDate: deliveryDate || new Date().toISOString().split('T')[0],
            fulfillmentMode: 'Outlet',
            note: note || 'Outlet Order Entry',
            createdBy: req.body.createdBy || req.user?.name || req.user?.fullname || 'Admin'
        }, { transaction: t });

        // 3. Create Items & Deduct Inventory Stock
        for (const pItem of processedItems) {
            await OutletOrderItem.create({
                outletOrderId: newOutletOrder.id,
                productId: pItem.productId,
                variantId: pItem.variantId,
                quantity: pItem.quantity,
                price: pItem.price,
                sellUnit: pItem.sellUnit,
                discount: pItem.discount,
                subtotal: pItem.subtotal,
                variantInfo: pItem.variantInfo
            }, { transaction: t });

            // Stock Deduction Logic
            const deductionRequired = Math.round(pItem.sellUnit === 'Inner'
                ? pItem.quantity
                : pItem.quantity * (pItem.variant.baseUnitsPerPack || 1));

            const stocks = await InventoryStock.findAll({
                where: {
                    productId: pItem.productId,
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
                    productId: pItem.productId,
                    variantId: pItem.variantId,
                    godownId: stock.godownId,
                    type: 'SALE',
                    primaryUnitId: stock.primaryUnitId,
                    secondaryUnitId: stock.secondaryUnitId,
                    secondaryPerPrimary: stock.secondaryPerPrimary,
                    totalQtyBaseUnits: deductFromThis,
                    balanceAfterBaseUnits: newTotalBaseUnits,
                    note: `Outlet Order #${generatedOrderId}`,
                    createdBy: req.user?.fullname || 'Admin'
                }, { transaction: t });

                remainingToDeduct -= deductFromThis;
            }

            if (remainingToDeduct > 0) {
                logger.warn(`[Outlet Order Stock Shortfall]: Order #${generatedOrderId} - Shortfall of ${remainingToDeduct} base units for product ${pItem.productId} in Godown ${targetGodownId}`);
            }
        }

        await t.commit();

        // 4. Log Activity for Activity Monitoring
        logActivity(req, {
            module: 'Outlet Orders',
            action: 'CREATE',
            description: `Created Outlet Order #${generatedOrderId} for ${finalCustomerName} (${finalShopName}) with amount ₹${finalGrandTotal}`,
            metadata: {
                orderId: newOutletOrder.id,
                generatedOrderId,
                grandTotal: finalGrandTotal,
                godownId: targetGodownId,
                itemsCount: processedItems.length
            }
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Outlet order created successfully.', {
            order: newOutletOrder
        });
    } catch (error) {
        await t.rollback();
        logger.error(`[createOutletOrder Error]: ${error.message}`, { stack: error.stack });
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to create outlet order.', error.message);
    }
};

/**
 * @desc    Get List of Outlet Orders (Paginated, Filtered & Status Counts)
 * @route   GET /api/admin/outlet-orders
 * @access  Private (Admin)
 */
export const getOutletOrders = async (req, res) => {
    try {
        const { search, godownId, paymentStatus, status, date, startDate, endDate, today } = req.query;
        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const whereCondition = {};

        if (godownId) {
            whereCondition.godownId = godownId;
        }

        if (paymentStatus) {
            whereCondition.paymentStatus = paymentStatus;
        }

        if (search) {
            whereCondition[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { customerPhone: { [Op.iLike]: `%${search}%` } },
                { shopName: { [Op.iLike]: `%${search}%` } }
            ];
        } else {
            if (status === 'Today' || today === 'true' || date) {
                const targetDateStr = (date && date !== 'undefined') ? date : new Date().toISOString().split('T')[0];
                const startOfDay = new Date(targetDateStr);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(targetDateStr);
                endOfDay.setHours(23, 59, 59, 999);
                whereCondition.createdAt = { [Op.between]: [startOfDay, endOfDay] };
            } else if (startDate && endDate) {
                whereCondition.createdAt = {
                    [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59.999Z`)]
                };
            } else if (status && status !== 'All' && status !== 'History' && status !== 'PaymentCollection') {
                whereCondition.orderStatus = status;
            }
        }

        const result = await OutletOrder.findAndCountAll({
            where: whereCondition,
            include: [
                { model: Godown, as: 'godown', attributes: ['id', 'name'], required: false },
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number'], required: false },
                {
                    model: OutletOrderItem,
                    as: 'items',
                    required: false,
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'boxNumber'], required: false },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'extra', 'purchasePrice', 'baseUnitsPerPack'], required: false }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        // Calculate Purchase Cost & Profit for each returned order
        const formattedRows = result.rows.map(orderItem => {
            const plain = orderItem.get({ plain: true });
            let totalPurchaseCost = 0;
            if (plain.items && plain.items.length > 0) {
                plain.items.forEach(it => {
                    const qty = Number(it.quantity || 0);
                    const sellUnit = it.sellUnit || 'Base';
                    const vInfo = it.variantInfo || {};
                    const pPrice = Number(vInfo.purchasePrice || it.variant?.purchasePrice || 0);
                    const bUPP = Number(vInfo.baseUnitsPerPack || it.variant?.baseUnitsPerPack || 1);
                    const unitCost = sellUnit === 'Inner' ? (pPrice / bUPP) : pPrice;
                    totalPurchaseCost += (unitCost * qty);
                });
            }
            const grandTotal = Number(plain.grandTotal || plain.totalAmount || 0);
            const profit = grandTotal - totalPurchaseCost;

            return {
                ...plain,
                purchaseCost: totalPurchaseCost,
                profit: profit
            };
        });

        // Compute Financial Summary across all matching orders
        const allOrdersForSummary = await OutletOrder.findAll({
            where: whereCondition,
            include: [
                {
                    model: OutletOrderItem,
                    as: 'items',
                    required: false,
                    include: [
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'purchasePrice', 'baseUnitsPerPack'], required: false }
                    ]
                }
            ]
        });

        let totalSales = 0;
        let totalPaid = 0;
        let totalDue = 0;
        let cashPaid = 0;
        let bankPaid = 0;
        let totalPurchaseCost = 0;
        const employeeMap = {};

        allOrdersForSummary.forEach(o => {
            const creator = o.createdBy || 'Admin';
            if (!employeeMap[creator]) {
                employeeMap[creator] = { employeeName: creator, cash: 0, bank: 0, total: 0, due: 0, ordersCount: 0 };
            }

            const gt = Number(o.grandTotal || o.totalAmount || 0);
            const paid = Number(o.paidAmount || 0);
            const due = Math.max(0, gt - paid);

            totalSales += gt;
            totalPaid += paid;
            totalDue += due;

            employeeMap[creator].ordersCount += 1;
            employeeMap[creator].total += gt;
            employeeMap[creator].due += due;

            const pmArr = o.payments && Array.isArray(o.payments) && o.payments.length > 0
                ? o.payments
                : [{ method: o.paymentMode || 'Cash', amount: paid }];

            pmArr.forEach(pm => {
                const amt = Number(pm.amount || 0);
                if (pm.method === 'Bank' || pm.method === 'Online') {
                    bankPaid += amt;
                    employeeMap[creator].bank += amt;
                } else {
                    cashPaid += amt;
                    employeeMap[creator].cash += amt;
                }
            });

            if (o.items && o.items.length > 0) {
                o.items.forEach(it => {
                    const qty = Number(it.quantity || 0);
                    const sellUnit = it.sellUnit || 'Base';
                    const vInfo = it.variantInfo || {};
                    const pPrice = Number(vInfo.purchasePrice || it.variant?.purchasePrice || 0);
                    const bUPP = Number(vInfo.baseUnitsPerPack || it.variant?.baseUnitsPerPack || 1);
                    const unitCost = sellUnit === 'Inner' ? (pPrice / bUPP) : pPrice;
                    totalPurchaseCost += (unitCost * qty);
                });
            }
        });

        const totalProfit = totalSales - totalPurchaseCost;

        const totalsSummary = {
            totalSales,
            totalPaid,
            totalDue,
            cashPaid,
            bankPaid,
            totalPurchaseCost,
            totalProfit,
            employeeBreakdown: Object.values(employeeMap)
        };

        // Tab counts
        const todayStr = new Date().toISOString().split('T')[0];
        const startOfToday = new Date(todayStr);
        startOfToday.setHours(0, 0, 0, 0);
        const endOfToday = new Date(todayStr);
        endOfToday.setHours(23, 59, 59, 999);

        const baseCountWhere = godownId ? { godownId } : {};

        const [todayCount, totalHistoryCount] = await Promise.all([
            OutletOrder.count({ where: { ...baseCountWhere, createdAt: { [Op.between]: [startOfToday, endOfToday] } } }),
            OutletOrder.count({ where: baseCountWhere })
        ]);

        const statusCounts = {
            Today: todayCount,
            History: totalHistoryCount,
            PaymentCollection: totalHistoryCount
        };

        const formatted = formatPaginatedResponse({ count: result.count, rows: formattedRows }, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Outlet orders fetched successfully.', {
            ...formatted,
            statusCounts,
            totalsSummary
        });
    } catch (error) {
        logger.error(`[getOutletOrders Error]: ${error.message}`, { stack: error.stack });
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to fetch outlet orders.', error.message);
    }
};

/**
 * @desc    Update Outlet Order Status
 * @route   PUT /api/admin/outlet-orders/:id/status
 * @access  Private (Admin)
 */
export const updateOutletOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { orderStatus } = req.body;

        const order = await OutletOrder.findByPk(id);
        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Outlet order not found.');
        }

        const oldStatus = order.orderStatus;

        // If order status is changed to Cancelled from an active status, restore stock to inventory
        const isNewCancelled = orderStatus === 'Cancelled' || orderStatus === 'Admin Cancel' || String(orderStatus).includes('Cancel');
        const wasOldCancelled = oldStatus === 'Cancelled' || oldStatus === 'Admin Cancel' || String(oldStatus).includes('Cancel');

        if (isNewCancelled && !wasOldCancelled) {
            const items = await OutletOrderItem.findAll({
                where: { outletOrderId: order.id }
            });

            for (const item of items) {
                const variant = await ProductVariant.findByPk(item.variantId);
                const bUPP = Number(variant?.baseUnitsPerPack || item.variantInfo?.baseUnitsPerPack || 1);
                const qtyToRestore = Math.round(item.sellUnit === 'Inner'
                    ? Number(item.quantity)
                    : Number(item.quantity) * bUPP);

                let stock = await InventoryStock.findOne({
                    where: {
                        productId: item.productId,
                        godownId: order.godownId
                    },
                    order: [['createdAt', 'DESC']]
                });

                if (stock) {
                    const newTotalBaseUnits = Number(stock.totalBaseUnits || 0) + qtyToRestore;
                    await stock.update({ totalBaseUnits: newTotalBaseUnits });

                    await InventoryTransaction.create({
                        stockId: stock.id,
                        productId: item.productId,
                        variantId: item.variantId,
                        godownId: order.godownId,
                        type: 'ADJUSTMENT',
                        primaryUnitId: stock.primaryUnitId,
                        secondaryUnitId: stock.secondaryUnitId,
                        secondaryPerPrimary: stock.secondaryPerPrimary,
                        totalQtyBaseUnits: qtyToRestore,
                        balanceAfterBaseUnits: newTotalBaseUnits,
                        note: `Cancelled Outlet Order #${order.orderId} Stock Restored`,
                        createdBy: req.user?.fullname || 'Admin'
                    });
                } else {
                    const newStock = await InventoryStock.create({
                        productId: item.productId,
                        variantId: item.variantId,
                        godownId: order.godownId,
                        primaryUnitId: variant?.volumeId || null,
                        secondaryUnitId: null,
                        secondaryPerPrimary: bUPP,
                        totalBaseUnits: qtyToRestore,
                        avgPurchasePricePerBaseUnit: item.price || 0,
                        lastPurchasePricePerBaseUnit: item.price || 0
                    });

                    await InventoryTransaction.create({
                        stockId: newStock.id,
                        productId: item.productId,
                        variantId: item.variantId,
                        godownId: order.godownId,
                        type: 'ADJUSTMENT',
                        primaryUnitId: newStock.primaryUnitId,
                        secondaryUnitId: newStock.secondaryUnitId,
                        secondaryPerPrimary: newStock.secondaryPerPrimary,
                        totalQtyBaseUnits: qtyToRestore,
                        balanceAfterBaseUnits: qtyToRestore,
                        note: `Cancelled Outlet Order #${order.orderId} Stock Restored`,
                        createdBy: req.user?.fullname || 'Admin'
                    });
                }
            }
        }

        await order.update({ orderStatus });

        logActivity(req, {
            module: 'Outlet Orders',
            action: 'STATUS_CHANGE',
            description: `Updated status of Outlet Order #${order.orderId} from ${oldStatus} to ${orderStatus}${isNewCancelled ? ' (Stock Restored)' : ''}`,
            metadata: { orderId: order.id, oldStatus, newStatus: orderStatus }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Outlet order status updated successfully.', order);
    } catch (error) {
        logger.error(`[updateOutletOrderStatus Error]: ${error.message}`, { stack: error.stack });
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to update outlet order status.', error.message);
    }
};

/**
 * @desc    Get Outlet Order Details by ID
 * @route   GET /api/admin/outlet-orders/:id
 * @access  Private (Admin)
 */
export const getOutletOrderById = async (req, res) => {
    try {
        const { id } = req.params;

        const order = await OutletOrder.findByPk(id, {
            include: [
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
                { model: User, as: 'user', attributes: ['id', 'fullname', 'number'] },
                {
                    model: OutletOrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'boxNumber'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'extra', 'purchasePrice', 'baseUnitsPerPack'] }
                    ]
                }
            ]
        });

        if (!order) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Outlet order not found.');
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Outlet order details fetched successfully.', order);
    } catch (error) {
        logger.error(`[getOutletOrderById Error]: ${error.message}`, { stack: error.stack });
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to fetch outlet order details.', error.message);
    }
};
