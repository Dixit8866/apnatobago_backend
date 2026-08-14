import { OutletOrder, OutletOrderItem, Product, ProductVariant, User, Volume, InventoryStock, InventoryTransaction, Godown } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

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
            deliveryDate = null,
            fulfillmentMode = 'ROUND',
            note = '',
            discountAmount = 0
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please add at least one item to the outlet order.');
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
                productName: variant.product?.name
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
        const numPaidAmount = Number(paidAmount || 0);
        let paymentStatus = 'Pending';
        if (numPaidAmount >= finalGrandTotal && finalGrandTotal > 0) {
            paymentStatus = 'Paid';
        } else if (numPaidAmount > 0) {
            paymentStatus = 'Partial';
        }

        // 2. Create OutletOrder record
        const newOutletOrder = await OutletOrder.create({
            orderId: generatedOrderId,
            userId: userId || null,
            customerName: (customerName && customerName.trim()) ? customerName.trim() : (userObj?.fullname || 'Guest'),
            customerPhone: customerPhone || userObj?.mobileNumber || '',
            shopName: shopName || userObj?.shopName || 'Direct Outlet',
            godownId: targetGodownId,
            orderStatus: 'Completed',
            fulfillmentStatus: 'Fulfilled',
            paymentStatus,
            totalAmount: totalOrderAmount,
            discountAmount: Number(discountAmount || 0),
            grandTotal: finalGrandTotal,
            paidAmount: numPaidAmount,
            paymentMode: paymentMode || 'Cash',
            deliveryDate: deliveryDate || new Date().toISOString().split('T')[0],
            fulfillmentMode: 'Outlet',
            note: note || 'Outlet Order Entry',
            createdBy: req.user?.fullname || 'Admin'
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
 * @desc    Get List of Outlet Orders (Paginated & Filtered)
 * @route   GET /api/admin/outlet-orders
 * @access  Private (Admin)
 */
export const getOutletOrders = async (req, res) => {
    try {
        const { search, godownId, paymentStatus, startDate, endDate } = req.query;
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
        }

        if (startDate && endDate) {
            whereCondition.createdAt = {
                [Op.between]: [new Date(startDate), new Date(`${endDate}T23:59:59.999Z`)]
            };
        }

        const result = await OutletOrder.findAndCountAll({
            where: whereCondition,
            include: [
                { model: Godown, as: 'godown', attributes: ['id', 'name'] },
                { model: User, as: 'user', attributes: ['id', 'fullname', 'mobileNumber', 'shopName'] },
                {
                    model: OutletOrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume', 'extra'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        const formatted = formatPaginatedResponse(result, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Outlet orders fetched successfully.', formatted);
    } catch (error) {
        logger.error(`[getOutletOrders Error]: ${error.message}`, { stack: error.stack });
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to fetch outlet orders.', error.message);
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
                { model: User, as: 'user', attributes: ['id', 'fullname', 'mobileNumber', 'shopName', 'address', 'city', 'pincode'] },
                {
                    model: OutletOrderItem,
                    as: 'items',
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
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
