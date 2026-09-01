import sequelize from '../config/db.js';
import logger from '../logger/apiLogger.js';

/**
 * Helper to restore inventory stock & create an InventoryTransaction log when an order is cancelled
 */
export const restoreOrderStock = async (orderId, actorName = 'System', transactionObj = null) => {
    try {
        const Order = sequelize.models.Order;
        const OrderItem = sequelize.models.OrderItem;
        const Product = sequelize.models.Product;
        const ProductVariant = sequelize.models.ProductVariant;
        const InventoryStock = sequelize.models.InventoryStock;
        const InventoryTransaction = sequelize.models.InventoryTransaction;
        const OrderAssignment = sequelize.models.OrderAssignment;

        const order = await Order.findByPk(orderId, {
            include: [{ model: OrderItem, as: 'items' }],
            transaction: transactionObj
        });

        if (!order || !order.items || order.items.length === 0) {
            return;
        }

        // Determine target godown ID (from order or order assignment)
        let targetGodownId = order.godownId;
        if (!targetGodownId && OrderAssignment) {
            const assignment = await OrderAssignment.findOne({
                where: { orderId: order.id },
                transaction: transactionObj
            });
            if (assignment) targetGodownId = assignment.godownId;
        }

        for (const item of order.items) {
            const variant = await ProductVariant.findByPk(item.variantId, {
                include: [{ model: Product, as: 'product' }],
                transaction: transactionObj
            });

            if (!variant) continue;

            const isCombo = variant.product?.isCombo;
            const comboProducts = isCombo
                ? [variant.product.comboProduct1Id, variant.product.comboProduct2Id].filter(Boolean)
                : [item.productId];

            for (const cpId of comboProducts) {
                let compVariant = variant;
                if (isCombo) {
                    compVariant = await ProductVariant.findOne({
                        where: { productId: cpId, ...(variant.volumeId ? { volumeId: variant.volumeId } : {}) },
                        transaction: transactionObj
                    }) || await ProductVariant.findOne({
                        where: { productId: cpId },
                        transaction: transactionObj
                    });
                }

                if (!compVariant) continue;

                const compBUPP = Number(compVariant.baseUnitsPerPack || 1);
                const compSellingVolume = Number(variant.sellingVolume || item.variantInfo?.sellingVolume || 1);
                const baseUnitsToRestore = Math.round(
                    item.sellUnit === 'Inner'
                        ? Number(item.quantity)
                        : Number(item.quantity) * compSellingVolume * compBUPP
                );

                if (baseUnitsToRestore <= 0) continue;

                // 1. Try to find exact matching stock by productId, variantId, and targetGodownId
                let stock = null;
                if (targetGodownId) {
                    stock = await InventoryStock.findOne({
                        where: { productId: cpId, variantId: compVariant.id, godownId: targetGodownId },
                        transaction: transactionObj
                    });
                }

                // 2. Fallback to matching by productId & variantId if godown not specified or stock not found
                if (!stock) {
                    stock = await InventoryStock.findOne({
                        where: { productId: cpId, variantId: compVariant.id },
                        order: [['createdAt', 'DESC']],
                        transaction: transactionObj
                    });
                }

                // 3. Fallback to matching by productId alone if variantId mismatch
                if (!stock) {
                    stock = await InventoryStock.findOne({
                        where: { productId: cpId },
                        order: [['createdAt', 'DESC']],
                        transaction: transactionObj
                    });
                }

                if (stock) {
                    const newTotalBaseUnits = Number(stock.totalBaseUnits || 0) + baseUnitsToRestore;
                    await stock.update({ totalBaseUnits: newTotalBaseUnits }, { transaction: transactionObj });

                    if (InventoryTransaction) {
                        await InventoryTransaction.create({
                            stockId: stock.id,
                            productId: cpId,
                            variantId: compVariant.id,
                            godownId: stock.godownId,
                            type: 'ADJUSTMENT',
                            primaryUnitId: stock.primaryUnitId,
                            secondaryUnitId: stock.secondaryUnitId,
                            secondaryPerPrimary: stock.secondaryPerPrimary,
                            qtyPrimary: Number(item.quantity || 0),
                            qtySecondary: 0,
                            totalQtyBaseUnits: baseUnitsToRestore,
                            balanceAfterBaseUnits: newTotalBaseUnits,
                            note: `Stock Restored (Cancelled Order #${order.orderId || order.id})`,
                            createdBy: actorName || 'System'
                        }, { transaction: transactionObj });
                    }

                    logger.info(`[Order Cancel Stock Restored]: orderId=${order.orderId}, productId=${cpId}, variantId=${compVariant.id}, restored=${baseUnitsToRestore} base units, newBalance=${newTotalBaseUnits}`);
                }
            }
        }
    } catch (err) {
        logger.error(`[Restore Order Stock Error]: ${err.message}`);
    }
};
