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
    DeliveryBoy
} from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * @desc    Process a Sales Return for one or more items in an order
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

        // 3. Find Delivery Boy from Assignment
        const assignment = await OrderAssignment.findOne({
            where: { orderId: order.id },
            transaction: t
        });
        const deliveryBoyId = assignment ? assignment.deliveryBoyId : null;

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

            // D. Create SalesReturn Record
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
                reason: rootReason || itemReason || "Customer Return",
                status: "Approved"
            }, { transaction: t });

            salesReturnEntries.push(salesReturnEntry);

            // E. Put Stock Back to Inventory
            const bUPP = Number(variant.baseUnitsPerPack || 1);
            const baseUnitsToRestore = Math.round(orderItem.sellUnit === 'Inner'
                ? returnQty
                : returnQty * bUPP);

            // Find the SALE transaction to restore stock to the exact godown and stock batch if possible
            const saleTxn = await InventoryTransaction.findOne({
                where: {
                    productId,
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
                    where: { productId, variantId: variant.id, godownId: targetGodownId },
                    transaction: t
                });

                if (targetStock) {
                    await targetStock.update({
                        totalBaseUnits: Number(targetStock.totalBaseUnits) + baseUnitsToRestore
                    }, { transaction: t });
                } else {
                    targetStock = await InventoryStock.create({
                        productId,
                        variantId: variant.id,
                        godownId: targetGodownId,
                        primaryUnitId: variant.baseUnitLabel || variant.innerUnitLabel || '00000000-0000-0000-0000-000000000000',
                        totalBaseUnits: baseUnitsToRestore,
                        status: 'Active'
                    }, { transaction: t });
                }
            }

            // Log the stock adjustment transaction
            await InventoryTransaction.create({
                stockId: targetStock.id,
                productId,
                variantId: variant.id,
                godownId: targetStock.godownId,
                type: 'SALES_RETURN',
                primaryUnitId: targetStock.primaryUnitId,
                secondaryUnitId: targetStock.secondaryUnitId,
                secondaryPerPrimary: targetStock.secondaryPerPrimary,
                totalQtyBaseUnits: baseUnitsToRestore,
                balanceAfterBaseUnits: Number(targetStock.totalBaseUnits),
                note: `Sales Return for Order #${order.orderId}`,
                createdBy: req.user?.fullname || req.user?.name || 'Delivery Boy'
            }, { transaction: t });

            // F. Adjust Order Item
            const remainingQty = orderedQty - returnQty;
            if (remainingQty <= 0) {
                // Remove the item completely from the order items
                await orderItem.destroy({ transaction: t });
            } else {
                // Update quantity of order item
                await orderItem.update({ quantity: remainingQty }, { transaction: t });
            }
        }

        // 5. Recalculate order total amount using remaining items
        const remainingItems = await OrderItem.findAll({
            where: { orderId: order.id },
            transaction: t
        });

        let newSubtotal = 0;
        for (const item of remainingItems) {
            newSubtotal += parseFloat(item.price) * parseFloat(item.quantity);
        }

        const deliveryCharge = parseFloat(order.deliveryCharge) || 0;
        const newTotalAmount = newSubtotal + deliveryCharge;

        // Update Order total and outstanding dues
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

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Sales return processed successfully.", {
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
 * @desc    Get all sales returns (Admin)
 * @route   GET /api/admin/orders/sales-returns
 * @access  Private (Admin)
 */
export const getSalesReturns = async (req, res) => {
    try {
        const { search, deliveryBoyId } = req.query;
        const where = {};

        if (deliveryBoyId) {
            where.deliveryBoyId = deliveryBoyId;
        }

        if (search) {
            where[Op.or] = [
                { '$order.orderId$': { [Op.iLike]: `%${search}%` } },
                { '$user.fullname$': { [Op.iLike]: `%${search}%` } },
                { '$user.businessProfile.shopName$': { [Op.iLike]: `%${search}%` } },
                { '$product.name$': { [Op.iLike]: `%${search}%` } },
                { '$deliveryBoy.name$': { [Op.iLike]: `%${search}%` } },
                { reason: { [Op.iLike]: `%${search}%` } }
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
                            attributes: ['id', 'shopName', 'shopAddress', 'postcode']
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
