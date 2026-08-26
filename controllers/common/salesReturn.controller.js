import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import {
    Order,
    OrderItem,
    ProductVariant,
    InventoryStock,
    InventoryTransaction,
    OrderAssignment,
    SalesReturn,
    User,
    Godown,
    Product,
    DeliveryBoy,
    PartyBalanceLog
} from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { roundTotal } from '../../utils/roundHelper.js';

/**
 * @desc    Process a Sales Return for one or more items in an order (Submitted by Delivery Boy, status set to 'Pending')
 * @route   POST /api/delivery/orders/sales-return
 * @access  Private
 */
export const createSalesReturn = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { orderId, reason: rootReason } = req.body;

        if (!orderId) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: orderId is missing.");
        }

        // 1. Normalize items array (supporting both bulk array format and single flat format)
        let inputItems = [];
        if (Array.isArray(req.body.items)) {
            inputItems = req.body.items;
        } else if (req.body.productId && req.body.quantity !== undefined) {
            inputItems = [{
                productId: req.body.productId,
                volumeId: req.body.volumeId,
                quantity: req.body.quantity,
                reason: req.body.reason
            }];
        }

        if (inputItems.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "No items provided for sales return.");
        }

        // 2. Find Order (either by UUID id or string orderId)
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
        const orderWhere = isUuid ? { id: orderId } : { orderId: orderId };
        const order = await Order.findOne({ where: orderWhere, transaction: t });

        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        // 3. Find Delivery Boy from Assignment (and verify existence to satisfy foreign key constraint)
        const assignment = await OrderAssignment.findOne({
            where: { orderId: order.id },
            transaction: t
        });
        let deliveryBoyId = null;
        if (assignment && assignment.deliveryBoyId) {
            const dbExists = await DeliveryBoy.findByPk(assignment.deliveryBoyId, { transaction: t });
            if (dbExists) {
                deliveryBoyId = assignment.deliveryBoyId;
            }
        }

        let totalReturnAmount = 0;
        const salesReturnEntries = [];

        // 4. Process each item inside the input list
        for (const item of inputItems) {
            const { productId, volumeId, quantity, reason: itemReason } = item;

            if (!productId || quantity === undefined || parseFloat(quantity) <= 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Each item must have a valid productId and quantity (> 0).");
            }

            // A. Find Product Variant
            const variantWhere = { productId };
            if (volumeId) {
                variantWhere.volumeId = volumeId;
            } else {
                variantWhere.volumeId = null;
            }
            let variant = await ProductVariant.findOne({ where: variantWhere, transaction: t });
            if (!variant) {
                // Fallback: try to find any variant for this product
                variant = await ProductVariant.findOne({ where: { productId }, transaction: t });
            }

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product variant not found for Product ID ${productId}.`);
            }

            // B. Find OrderItem
            const orderItem = await OrderItem.findOne({
                where: {
                    orderId: order.id,
                    productId,
                    variantId: variant.id
                },
                transaction: t
            });

            if (!orderItem) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product/Variant ${productId} not found in this order.`);
            }

            const orderedQty = parseFloat(orderItem.quantity);
            const returnQty = parseFloat(quantity);

            if (returnQty > orderedQty) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Returned quantity (${returnQty}) cannot exceed ordered quantity (${orderedQty}) for Product ID ${productId}.`);
            }

            // C. Calculate Return Amount for this item
            const itemPrice = parseFloat(orderItem.price);
            const returnAmount = returnQty * itemPrice;
            totalReturnAmount += returnAmount;

            // D. Create SalesReturn Record with PENDING status
            // Use a prefix in reason to record whether it was sold as 'Inner' or 'Base' (avoids schema migrations)
            const sellUnitPrefix = orderItem.sellUnit === 'Inner' ? '[Inner]' : '[Base]';
            const salesReturnEntry = await SalesReturn.create({
                orderId: order.id,
                userId: order.userId,
                deliveryBoyId,
                productId,
                variantId: variant.id,
                volumeId: variant.volumeId,
                quantity: returnQty,
                price: itemPrice,
                returnAmount,
                reason: `${sellUnitPrefix} ${rootReason || itemReason || "Customer Return"}`,
                status: "Pending" // Explicitly start in Pending status!
            }, { transaction: t });

            salesReturnEntries.push(salesReturnEntry);

            // E. Adjust Order Item IMMEDIATELY (so quantities decrease on customer invoice/order detail screen)
            const remainingQty = orderedQty - returnQty;
            if (remainingQty <= 0) {
                // Remove the item completely from the order items
                await orderItem.destroy({ transaction: t });
            } else {
                // Update quantity of order item
                await orderItem.update({ quantity: remainingQty }, { transaction: t });
            }
        }

        // 5. Recalculate order total amount using remaining items IMMEDIATELY
        const remainingItems = await OrderItem.findAll({
            where: { orderId: order.id },
            transaction: t
        });

        let newSubtotal = 0;
        for (const item of remainingItems) {
            newSubtotal += parseFloat(item.price) * parseFloat(item.quantity);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge) || 0;
        const newTotalAmount = roundTotal(newSubtotal + deliveryCharge);

        // Update Order total and outstanding dues IMMEDIATELY
        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, parseFloat(order.dueAmount) - totalReturnAmount);

        // If total outstanding becomes 0 and they paid rest, set paid status appropriately
        if (parseFloat(order.dueAmount) <= 0) {
            order.paymentStatus = 'Paid';
        } else if (parseFloat(order.dueAmount) < newTotalAmount) {
            order.paymentStatus = 'Partial';
        }

        await order.save({ transaction: t });

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, "Sales return request submitted successfully and customer order updated.", {
            salesReturns: salesReturnEntries,
            newOrderTotal: order.totalAmount,
            newOrderDueAmount: order.dueAmount
        });

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Create Sales Return Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Approve a Sales Return (Admin physically verifies the stock and updates)
 * @route   PUT /api/admin/orders/sales-returns/:id/approve
 * @access  Private (Admin)
 */
export const approveSalesReturn = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { id } = req.params;

        // 1. Fetch SalesReturn Entry
        const salesReturn = await SalesReturn.findByPk(id, { transaction: t });
        if (!salesReturn) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Sales return entry not found.");
        }

        if (salesReturn.status === 'Approved') {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "This sales return is already approved.");
        }

        // 2. Fetch Order
        const order = await Order.findByPk(salesReturn.orderId, { transaction: t });
        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Associated order not found.");
        }

        // 3. Fetch Product Variant
        const variant = await ProductVariant.findByPk(salesReturn.variantId, { transaction: t });
        if (!variant) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Product variant not found.");
        }

        // E. Put Stock Back to Inventory
        const returnQty = parseFloat(salesReturn.quantity);
        const bUPP = Number(variant.baseUnitsPerPack || 1);

        // Deduce the original sell unit from the reason prefix
        const isInner = salesReturn.reason && salesReturn.reason.startsWith('[Inner]');
        const baseUnitsToRestore = Math.round(isInner ? returnQty : returnQty * bUPP);

        // Find the SALE transaction to restore stock to the exact godown and stock batch if possible
        const saleTxn = await InventoryTransaction.findOne({
            where: {
                productId: salesReturn.productId,
                variantId: variant.id,
                type: 'SALE',
                note: { [Op.like]: `%${order.orderId}%` }
            },
            order: [['createdAt', 'DESC']],
            transaction: t
        });

        let targetStock = null;
        if (saleTxn) {
            targetStock = await InventoryStock.findOne({
                where: { id: saleTxn.stockId },
                transaction: t
            });
            if (targetStock) {
                await targetStock.update({
                    totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                }, { transaction: t });
            }
        }

        // Fallback: If no SALE txn or specific batch found, find/create stock batch in user postcode godown or any godown
        if (!targetStock) {
            let targetGodownId = null;
            if (order.userId) {
                const user = await User.findByPk(order.userId, { transaction: t });
                if (user && user.postcode) {
                    const godown = await Godown.findOne({
                        where: { pincodes: { [Op.contains]: [user.postcode] } },
                        transaction: t
                    });
                    if (godown) targetGodownId = godown.id;
                }
            }
            if (!targetGodownId) {
                const godown = await Godown.findOne({ transaction: t });
                if (godown) targetGodownId = godown.id;
            }

            if (!targetGodownId) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, "No Godown available to return stock to.");
            }

            targetStock = await InventoryStock.findOne({
                where: { productId: salesReturn.productId, variantId: variant.id, godownId: targetGodownId },
                transaction: t
            });

            if (targetStock) {
                await targetStock.update({
                    totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                }, { transaction: t });
            } else {
                targetStock = await InventoryStock.create({
                    productId: salesReturn.productId,
                    variantId: variant.id,
                    godownId: targetGodownId,
                    primaryUnitId: variant.baseUnitLabel || variant.innerUnitLabel || '00000000-0000-0000-0000-000000000000',
                    totalBaseUnits: baseUnitsToRestore,
                    status: 'Active'
                }, { transaction: t });
            }
        }

        // Log the stock adjustment transaction - ACTION BY: Logged-in admin/user name!
        const actorName = req.user?.fullname || req.user?.name || 'Admin';
        await InventoryTransaction.create({
            stockId: targetStock.id,
            productId: salesReturn.productId,
            variantId: variant.id,
            godownId: targetStock.godownId,
            type: 'SALES_RETURN',
            primaryUnitId: targetStock.primaryUnitId,
            secondaryUnitId: targetStock.secondaryUnitId,
            secondaryPerPrimary: targetStock.secondaryPerPrimary,
            totalQtyBaseUnits: baseUnitsToRestore,
            balanceAfterBaseUnits: Number(targetStock.totalBaseUnits),
            note: `Sales Return Approved for Order #${order.orderId}`,
            createdBy: actorName
        }, { transaction: t });

        // H. Finally update status to Approved and clean the unit prefix from reason if visible
        salesReturn.status = 'Approved';
        salesReturn.reason = salesReturn.reason ? salesReturn.reason.replace(/^\[Inner\]\s*|^\[Base\]\s*/, '') : salesReturn.reason;
        await salesReturn.save({ transaction: t });

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sales return approved successfully and inventory updated.", {
            salesReturn,
            newOrderTotal: order.totalAmount,
            newOrderDueAmount: order.dueAmount
        });

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Approve Sales Return Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get all sales returns (Admin)
 * @route   GET /api/admin/orders/sales-returns
 * @access  Private (Admin)
 */
export const getSalesReturns = async (req, res) => {
    try {
        const { search, deliveryBoyId, godownId } = req.query;
        const where = {};

        if (deliveryBoyId) {
            where.deliveryBoyId = deliveryBoyId;
        }

        if (godownId) {
            where['$order.godownId$'] = godownId;
        }

        if (search) {
            const escapedSearch = sequelize.escape(`%${search}%`);
            where[Op.and] = [
                sequelize.literal(`(
                    "order"."orderId" ILIKE ${escapedSearch}
                    OR "user"."fullname" ILIKE ${escapedSearch}
                    OR "user->businessProfile"."shopName" ILIKE ${escapedSearch}
                    OR "user->businessProfile"."shopNameAlt" ILIKE ${escapedSearch}
                    OR "product"."name" ILIKE ${escapedSearch}
                    OR "deliveryBoy"."name" ILIKE ${escapedSearch}
                    OR "SalesReturn"."reason" ILIKE ${escapedSearch}
                )`)
            ];
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const result = await SalesReturn.findAndCountAll({
            where,
            include: [
                {
                    model: Order,
                    as: 'order',
                    attributes: ['id', 'orderId', 'totalAmount', 'createdAt']
                },
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullname', 'number', 'city'],
                    include: [
                        {
                            model: User.sequelize.models.BusinessProfile,
                            as: 'businessProfile',
                            attributes: ['id', 'shopName', 'shopNameAlt', 'shopAddress', 'postcode']
                        }
                    ]
                },
                {
                    model: DeliveryBoy,
                    as: 'deliveryBoy',
                    attributes: ['id', 'name', 'phone']
                },
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'thumbnail']
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    attributes: ['id', 'volume', 'image', 'innerUnitLabel', 'baseUnitLabel', 'volumeId'],
                    include: [
                        { model: User.sequelize.models.Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                        { model: User.sequelize.models.Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                        { model: User.sequelize.models.Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sales returns fetched successfully.", responseData);
    } catch (error) {
        logger.error(`[Get Sales Returns Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
/**
 * @desc    Approve ALL pending Sales Returns for a specific Order (Admin)
 * @route   PUT /api/admin/orders/sales-returns/approve-all/:orderId
 * @access  Private (Admin)
 */
export const approveAllSalesReturnByOrder = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { orderId } = req.params;

        // Find all PENDING returns for this order
        const pendingReturns = await SalesReturn.findAll({
            where: { orderId, status: 'Pending' },
            transaction: t
        });

        if (!pendingReturns.length) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "No pending sales returns found for this order.");
        }

        const order = await Order.findByPk(orderId, { transaction: t });
        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Associated order not found.");
        }

        const actorName = req.user?.fullname || req.user?.name || 'Admin';
        const approvedIds = [];

        for (const salesReturn of pendingReturns) {
            const variant = await ProductVariant.findByPk(salesReturn.variantId, { transaction: t });
            if (!variant) continue;

            const returnQty = parseFloat(salesReturn.quantity);
            const bUPP = Number(variant.baseUnitsPerPack || 1);
            const isInner = salesReturn.reason && salesReturn.reason.startsWith('[Inner]');
            const baseUnitsToRestore = Math.round(isInner ? returnQty : returnQty * bUPP);

            // Find the SALE transaction for precise stock restoration
            const saleTxn = await InventoryTransaction.findOne({
                where: {
                    productId: salesReturn.productId,
                    variantId: variant.id,
                    type: 'SALE',
                    note: { [Op.like]: `%${order.orderId}%` }
                },
                order: [['createdAt', 'DESC']],
                transaction: t
            });

            let targetStock = null;
            if (saleTxn) {
                targetStock = await InventoryStock.findOne({
                    where: { id: saleTxn.stockId },
                    transaction: t
                });
                if (targetStock) {
                    await targetStock.update({
                        totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                    }, { transaction: t });
                }
            }

            if (!targetStock) {
                let targetGodownId = null;
                if (order.userId) {
                    const user = await User.findByPk(order.userId, { transaction: t });
                    if (user && user.postcode) {
                        const godown = await Godown.findOne({
                            where: { pincodes: { [Op.contains]: [user.postcode] } },
                            transaction: t
                        });
                        if (godown) targetGodownId = godown.id;
                    }
                }
                if (!targetGodownId) {
                    const godown = await Godown.findOne({ transaction: t });
                    if (godown) targetGodownId = godown.id;
                }

                if (!targetGodownId) continue; // Skip if no godown found

                targetStock = await InventoryStock.findOne({
                    where: { productId: salesReturn.productId, variantId: variant.id, godownId: targetGodownId },
                    transaction: t
                });

                if (targetStock) {
                    await targetStock.update({
                        totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                    }, { transaction: t });
                } else {
                    targetStock = await InventoryStock.create({
                        productId: salesReturn.productId,
                        variantId: variant.id,
                        godownId: targetGodownId,
                        primaryUnitId: variant.baseUnitLabel || variant.innerUnitLabel || '00000000-0000-0000-0000-000000000000',
                        totalBaseUnits: baseUnitsToRestore,
                        status: 'Active'
                    }, { transaction: t });
                }
            }

            // Log inventory transaction
            await InventoryTransaction.create({
                stockId: targetStock.id,
                productId: salesReturn.productId,
                variantId: variant.id,
                godownId: targetStock.godownId,
                type: 'SALES_RETURN',
                primaryUnitId: targetStock.primaryUnitId,
                secondaryUnitId: targetStock.secondaryUnitId,
                secondaryPerPrimary: targetStock.secondaryPerPrimary,
                totalQtyBaseUnits: baseUnitsToRestore,
                balanceAfterBaseUnits: Number(targetStock.totalBaseUnits),
                note: `Sales Return Approved (Bulk) for Order #${order.orderId}`,
                createdBy: actorName
            }, { transaction: t });

            // Update return status
            salesReturn.status = 'Approved';
            salesReturn.reason = salesReturn.reason ? salesReturn.reason.replace(/^\[Inner\]\s*|^\[Base\]\s*/, '') : salesReturn.reason;
            await salesReturn.save({ transaction: t });
            approvedIds.push(salesReturn.id);
        }

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.OK, `${approvedIds.length} sales return(s) approved successfully and inventory updated.`, {
            approvedCount: approvedIds.length,
            approvedIds
        });

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Approve All Sales Returns Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Get delivered orders for a specific party for return bill selection dropdown
 * @route   GET /api/admin/orders/party/:userId/orders-for-return
 * @access  Private (Admin)
 */
export const getPartyOrdersForReturn = async (req, res) => {
    try {
        const { userId } = req.params;
        const { search } = req.query;

        const where = { userId };
        if (search) {
            where[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } }
            ];
        }

        const orders = await Order.findAll({
            where,
            include: [
                {
                    model: OrderItem,
                    as: 'items',
                    include: [
                        {
                            model: Product,
                            as: 'product',
                            attributes: ['id', 'name', 'thumbnail']
                        },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            attributes: ['id', 'volume', 'image', 'baseUnitsPerPack', 'innerUnitLabel', 'baseUnitLabel']
                        }
                    ]
                }
            ],
            order: [['createdAt', 'DESC']],
            limit: 50
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Party orders fetched for sales return.", orders);
    } catch (error) {
        logger.error(`[Get Party Orders For Return Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};

/**
 * @desc    Create Direct Admin Sales Return with Good/Damaged Condition and Party Jama Credit
 * @route   POST /api/admin/orders/sales-returns/direct
 * @access  Private (Admin)
 */
export const createAdminSalesReturn = async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const { orderId, items, condition: globalCondition, reason: globalReason } = req.body;

        if (!orderId || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Required fields: orderId and non-empty items array are required.");
        }

        // Find Order
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
        const orderWhere = isUuid ? { id: orderId } : { orderId: orderId };
        const order = await Order.findOne({ where: orderWhere, transaction: t });

        if (!order) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Order not found.");
        }

        const user = await User.findByPk(order.userId, { transaction: t });
        if (!user) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, "Customer / Party not found for this order.");
        }

        let totalReturnAmount = 0;
        const salesReturnEntries = [];
        const actorName = req.user ? (req.user.name || req.user.fullname || 'Admin') : 'Admin';

        // Check assigned delivery boy (and verify existence to satisfy foreign key constraint)
        const assignment = await OrderAssignment.findOne({
            where: { orderId: order.id },
            transaction: t
        });
        let validDeliveryBoyId = null;
        if (assignment && assignment.deliveryBoyId) {
            const dbExists = await DeliveryBoy.findByPk(assignment.deliveryBoyId, { transaction: t });
            if (dbExists) {
                validDeliveryBoyId = assignment.deliveryBoyId;
            }
        }

        for (const item of items) {
            const { productId, variantId, quantity, price, sellUnit, condition: itemCondition, reason: itemReason } = item;
            const returnQty = parseFloat(quantity || 0);
            const itemPrice = parseFloat(price || 0);

            if (!productId || !variantId || returnQty <= 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Each return item must have productId, variantId, and quantity > 0.");
            }

            const variant = await ProductVariant.findByPk(variantId, { transaction: t });
            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Product variant ${variantId} not found.`);
            }

            const orderItem = await OrderItem.findOne({
                where: { orderId: order.id, productId, variantId },
                transaction: t
            });

            if (!orderItem) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, `Item not found in order #${order.orderId}.`);
            }

            const orderedQty = parseFloat(orderItem.quantity);
            if (returnQty > orderedQty) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Return quantity (${returnQty}) exceeds ordered quantity (${orderedQty}).`);
            }

            const returnAmt = returnQty * itemPrice;
            totalReturnAmount += returnAmt;

            const itemCond = itemCondition || globalCondition || 'GOOD'; // 'GOOD' | 'DAMAGED'
            const itemNoteReason = itemReason || globalReason || 'Customer Return';
            const unitPrefix = (sellUnit || orderItem.sellUnit) === 'Inner' ? '[Inner]' : '[Base]';

            // Create Sales Return Record with Approved status
            const salesReturn = await SalesReturn.create({
                orderId: order.id,
                userId: order.userId,
                deliveryBoyId: validDeliveryBoyId,
                productId,
                variantId,
                volumeId: variant.volumeId,
                quantity: returnQty,
                price: itemPrice,
                returnAmount: returnAmt,
                reason: `${unitPrefix} ${itemNoteReason}`,
                condition: itemCond,
                creditProcessed: true,
                status: 'Approved'
            }, { transaction: t });

            salesReturnEntries.push(salesReturn);

            // Handle Stock Inventory Adjustment based on Condition
            const bUPP = Number(variant.baseUnitsPerPack || 1);
            const isInner = (sellUnit || orderItem.sellUnit) === 'Inner';
            const baseUnitsToRestore = Math.round(isInner ? returnQty : returnQty * bUPP);

            // Find Godown target
            let targetGodownId = order.godownId;
            if (!targetGodownId && user.postcode) {
                const godown = await Godown.findOne({
                    where: { pincodes: { [Op.contains]: [user.postcode] } },
                    transaction: t
                });
                if (godown) targetGodownId = godown.id;
            }
            if (!targetGodownId) {
                const godown = await Godown.findOne({ transaction: t });
                if (godown) targetGodownId = godown.id;
            }

            if (targetGodownId) {
                let targetStock = await InventoryStock.findOne({
                    where: { productId, variantId, godownId: targetGodownId },
                    transaction: t
                });

                if (!targetStock) {
                    targetStock = await InventoryStock.create({
                        productId,
                        variantId,
                        godownId: targetGodownId,
                        primaryUnitId: variant.baseUnitLabel || variant.innerUnitLabel || '00000000-0000-0000-0000-000000000000',
                        totalBaseUnits: 0,
                        status: 'Active'
                    }, { transaction: t });
                }

                if (itemCond === 'GOOD') {
                    // Restore stock for saleable inventory
                    await targetStock.update({
                        totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                    }, { transaction: t });

                    await InventoryTransaction.create({
                        stockId: targetStock.id,
                        productId,
                        variantId,
                        godownId: targetGodownId,
                        type: 'SALES_RETURN',
                        primaryUnitId: targetStock.primaryUnitId,
                        secondaryUnitId: targetStock.secondaryUnitId,
                        secondaryPerPrimary: targetStock.secondaryPerPrimary,
                        totalQtyBaseUnits: baseUnitsToRestore,
                        balanceAfterBaseUnits: Number(targetStock.totalBaseUnits),
                        note: `Sales Return Restocked (Good) for Order #${order.orderId}`,
                        createdBy: actorName
                    }, { transaction: t });
                } else {
                    // Log Damaged Loss Transaction without increasing sellable stock
                    await InventoryTransaction.create({
                        stockId: targetStock.id,
                        productId,
                        variantId,
                        godownId: targetGodownId,
                        type: 'DAMAGED_RETURN',
                        primaryUnitId: targetStock.primaryUnitId,
                        secondaryUnitId: targetStock.secondaryUnitId,
                        secondaryPerPrimary: targetStock.secondaryPerPrimary,
                        totalQtyBaseUnits: baseUnitsToRestore,
                        balanceAfterBaseUnits: Number(targetStock.totalBaseUnits),
                        note: `Sales Return Damaged Loss (Scrap) for Order #${order.orderId}`,
                        createdBy: actorName
                    }, { transaction: t });
                }
            }

            // Adjust Order Item
            const remainingQty = orderedQty - returnQty;
            if (remainingQty <= 0) {
                await orderItem.destroy({ transaction: t });
            } else {
                await orderItem.update({ quantity: remainingQty }, { transaction: t });
            }
        }

        // Recalculate Order Total Amount
        const remainingItems = await OrderItem.findAll({
            where: { orderId: order.id },
            transaction: t
        });

        let newSubtotal = 0;
        for (const item of remainingItems) {
            newSubtotal += parseFloat(item.price) * parseFloat(item.quantity);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge) || 0;
        const newTotalAmount = roundTotal(newSubtotal + deliveryCharge);
        order.totalAmount = newTotalAmount;
        order.dueAmount = Math.max(0, parseFloat(order.dueAmount) - totalReturnAmount);
        await order.save({ transaction: t });

        // Update Party Wallet Balance (Jama Credit +totalReturnAmount)
        const prevBal = parseFloat(user.walletBalance || 0);
        const newBal = prevBal + totalReturnAmount;
        await user.update({ walletBalance: newBal }, { transaction: t });

        // Create Party Balance Log Entry
        await PartyBalanceLog.create({
            userId: user.id,
            orderId: order.id,
            type: 'JAMA',
            amount: totalReturnAmount,
            previousBalance: prevBal,
            newBalance: newBal,
            note: `Sales Return Jama Credit (+₹${totalReturnAmount.toFixed(2)}) for Order #${order.orderId}`,
            createdById: req.user?.id || null,
            createdByName: actorName
        }, { transaction: t });

        await t.commit();

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, `Sales return created successfully. ₹${totalReturnAmount.toFixed(2)} Jama credited to ${user.fullname}'s wallet.`, {
            salesReturns: salesReturnEntries,
            partyWalletBalance: newBal,
            newOrderTotal: newTotalAmount
        });

    } catch (error) {
        if (t) await t.rollback();
        logger.error(`[Create Admin Sales Return Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
