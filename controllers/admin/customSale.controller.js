import { Order, OrderItem, Product, ProductVariant, User, Volume, Godown, InventoryStock, InventoryTransaction, ProductPricing } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import logger from '../../logger/apiLogger.js';
import sequelize from '../../config/db.js';
import { Op } from 'sequelize';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';

/**
 * Generate a unique human-readable Order ID for Direct Sales
 */
const generateUniqueDirectSaleId = () => {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    return `DIR-${timestamp}${random}`;
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
            godownId,
            notes
        } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Sale must contain at least one item.");
        }

        if (!godownId) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, "Godown ID is required for stock deduction.");
        }

        let totalAmount = 0;
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

            const itemPrice = parseFloat(manualPrice || variant.purchasePrice || 0);
            const itemSubtotal = itemPrice * parseFloat(quantity);
            totalAmount += itemSubtotal;

            const sellUnit = item.sellUnit || 'Base';
            const isLoose = sellUnit === 'Inner';
            
            orderItemsData.push({
                productId: variant.productId,
                variantId,
                quantity,
                price: itemPrice,
                sellUnit,
                variantInfo: {
                    productName: (variant.product.name?.en || variant.product.name?.gu || variant.product.name?.HN || variant.product.name || 'Product'),
                    volume: (variant.volumeRef?.name?.en || variant.volumeRef?.name?.gu || variant.volumeRef?.name?.HN || variant.volume || ''),
                    image: variant.image || variant.product.thumbnail,
                    innerUnitLabel: variant.innerUnitRef?.name?.en || variant.innerUnitRef?.name?.gu || 'Pcs',
                    baseUnitLabel: variant.baseUnitRef?.name?.en || variant.baseUnitRef?.name?.gu || 'Pack',
                    sellingVolume: variant.sellingVolume,
                    baseUnitsPerPack: variant.baseUnitsPerPack || 1
                }
            });
        }

        const paidAmount = parseFloat(rawPaidAmount || 0);
        const dueAmount = Math.max(0, totalAmount - paidAmount);
        
        let paymentStatus = 'Pending';
        if (paidAmount >= totalAmount) paymentStatus = 'Paid';
        else if (paidAmount > 0) paymentStatus = 'Partial';

        // 2. Create the Order
        const newSale = await Order.create({
            orderId: generateUniqueDirectSaleId(),
            userId: userId || null,
            customerName: userId ? null : customerName,
            customerNumber: userId ? null : customerNumber,
            totalAmount,
            paidAmount,
            dueAmount,
            paymentMethod: paymentMethod || 'Cash',
            paymentStatus,
            orderStatus: 'Delivered', // Custom sales are usually delivered immediately
            saleType: 'Direct',
            notes
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
                    variantId: item.variantId, 
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
                    note: `Direct Sale #${newSale.orderId}`
                }, { transaction: t });

                remainingToDeduct -= deductFromThis;
            }
            
            if (remainingToDeduct > 0) {
                // For direct sales, we might allow negative stock or just log a warning
                logger.warn(`[Direct Sale Stock Warning]: Order #${newSale.orderId} - Shortfall of ${remainingToDeduct} base units for variant ${item.variantId}`);
            }
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
        const { search, date } = req.query;
        const where = { saleType: 'Direct' };

        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);
            where.createdAt = { [Op.between]: [startOfDay, endOfDay] };
        }

        if (search) {
            where[Op.or] = [
                { orderId: { [Op.iLike]: `%${search}%` } },
                { customerName: { [Op.iLike]: `%${search}%` } },
                { '$user.fullname$': { [Op.iLike]: `%${search}%` } }
            ];
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
                        { model: Product, as: 'product', attributes: ['id', 'name'] },
                        { model: ProductVariant, as: 'variant', attributes: ['id', 'volume'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, "Custom sales fetched successfully.", formatPaginatedResponse(result, page, limit));
    } catch (error) {
        logger.error(`[Get Custom Sales Error]: ${error.message}`);
        return sendErrorResponse(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, error.message);
    }
};
