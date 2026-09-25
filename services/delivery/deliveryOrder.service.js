import { Op } from 'sequelize';
import { 
    OrderAssignment, 
    Order, 
    User, 
    OrderItem, 
    Product, 
    ProductVariant, 
    Volume, 
    OrderPayment, 
    InventoryStock, 
    SalesReturn, 
    Notification, 
    BusinessProfile, 
    DeliveryBoy 
} from '../../models/index.js';
import logger from '../../logger/apiLogger.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { roundTotal } from '../../utils/roundHelper.js';
import { sendToDevice } from '../notification.service.js';
import { broadcastOrderStatusChanged, broadcastOrderDelivered } from '../socketEvent.service.js';
import { calculateOrderFinancials, syncPartyDeliveryNotice } from '../financialSettlement.service.js';
import { getTodayRangeIST } from '../../controllers/delivery/dashboard.controller.js';

/**
 * ==============================================================================
 * DELIVERY ORDER SERVICE
 * ==============================================================================
 * Handles order assignments, details retrieval, items volume enrichment,
 * previous bills calculation, and status updates for delivery boy operations.
 */

/**
 * Send push notification when an order is delivered
 */
export const sendDeliveredNotification = async (orderId) => {
    try {
        const order = await Order.findByPk(orderId, {
            include: [{ model: User, as: 'user' }]
        });
        if (order && order.user && order.user.fcmtoken) {
            const title = 'Order Delivered!';
            const body = `Hey ${order.user.fullname}, your order #${order.orderId} of ₹${order.totalAmount} has been delivered successfully!`;
            await sendToDevice(order.user.fcmtoken, title, body, null, { type: 'order', id: String(order.id), orderId: String(order.id) });
            await Notification.create({
                title,
                body,
                type: 'ORDER',
                target: String(order.userId),
                status: 'SENT',
                clickAction: String(order.id)
            });
        }
    } catch (pushErr) {
        logger.error(`[Delivered Push Notification Error]: ${pushErr.message}`);
    }
};

/**
 * Enrich order items with volume options, base units, and single unit prices
 */
export const enrichItemsWithProductVolumes = async (items) => {
    if (!items || !Array.isArray(items) || items.length === 0) return items;

    const productIds = [...new Set(items.map(item => item.productId).filter(Boolean))];
    if (productIds.length === 0) return items;

    let productVariantsMap = {};
    try {
        const variants = await ProductVariant.findAll({
            where: {
                productId: { [Op.in]: productIds },
                status: 'Active'
            },
            include: [
                { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
            ]
        });

        variants.forEach(v => {
            if (!productVariantsMap[v.productId]) {
                productVariantsMap[v.productId] = [];
            }
            productVariantsMap[v.productId].push(v);
        });
    } catch (err) {
        logger.error(`[enrichItemsWithProductVolumes] Error fetching variants: ${err.message}`);
    }

    const helperGetVolName = (vObj) => {
        if (!vObj) return '';
        if (typeof vObj.name === 'string') return vObj.name;
        if (typeof vObj.name === 'object' && vObj.name !== null) {
            return vObj.name.en || vObj.name.guj || Object.values(vObj.name)[0] || '';
        }
        return '';
    };

    for (const item of items) {
        const itemVariant = item.variant || {};
        const variantInfo = item.variantInfo || {};
        
        const baseUnitsPerPack = Number(itemVariant.baseUnitsPerPack || variantInfo.baseUnitsPerPack || 1);
        const sellingVolume = Number(itemVariant.sellingVolume || variantInfo.sellingVolume || 1);
        const packUnits = (baseUnitsPerPack * sellingVolume) > 0 ? (baseUnitsPerPack * sellingVolume) : 1;

        const itemPrice = parseFloat(item.price || 0);
        const singleUnitPrice = itemPrice / packUnits;

        item.baseUnitsPerPack = baseUnitsPerPack;
        item.sellingVolume = sellingVolume;
        item.packUnits = packUnits;
        item.singleUnitPrice = parseFloat(singleUnitPrice.toFixed(2));
        item.unitPrice = parseFloat(singleUnitPrice.toFixed(2));
        item.totalUnits = parseFloat((parseFloat(item.quantity || 0) * packUnits).toFixed(2));

        const pVariants = productVariantsMap[item.productId] || [];
        const volumeOptions = [];

        pVariants.forEach(v => {
            const volName = helperGetVolName(v.volumeRef) ||
                           helperGetVolName(v.baseUnitRef) ||
                           helperGetVolName(v.innerUnitRef) ||
                           v.volume || v.extra || 'Unit';

            const vBaseUnits = Number(v.baseUnitsPerPack || 1);
            const vSellingVol = Number(v.sellingVolume || 1);
            const vPackUnits = (vBaseUnits * vSellingVol) > 0 ? (vBaseUnits * vSellingVol) : 1;
            const calculatedPrice = parseFloat((singleUnitPrice * vPackUnits).toFixed(2));

            volumeOptions.push({
                id: v.id,
                variantId: v.id,
                volumeId: v.volumeId,
                volumeName: volName,
                volume: volName,
                baseUnitsPerPack: vBaseUnits,
                sellingVolume: vSellingVol,
                unitsPerPack: vPackUnits,
                singleUnitPrice: parseFloat(singleUnitPrice.toFixed(2)),
                price: calculatedPrice > 0 ? calculatedPrice : parseFloat(v.purchasePrice || 0),
                purchasePrice: parseFloat(v.purchasePrice || 0)
            });
        });

        if (volumeOptions.length === 0) {
            const currentVolName = typeof variantInfo.volume === 'string' ? variantInfo.volume : '1 Pack';
            volumeOptions.push({
                id: item.variantId,
                variantId: item.variantId,
                volumeId: itemVariant.volumeId || null,
                volumeName: currentVolName,
                volume: currentVolName,
                baseUnitsPerPack: baseUnitsPerPack,
                sellingVolume: sellingVolume,
                unitsPerPack: packUnits,
                singleUnitPrice: parseFloat(singleUnitPrice.toFixed(2)),
                price: itemPrice
            });

            if (packUnits > 1) {
                volumeOptions.push({
                    id: item.variantId,
                    variantId: item.variantId,
                    volumeId: null,
                    volumeName: '1 Pcs / Unit',
                    volume: '1 Pcs / Unit',
                    baseUnitsPerPack: 1,
                    sellingVolume: 1,
                    unitsPerPack: 1,
                    singleUnitPrice: parseFloat(singleUnitPrice.toFixed(2)),
                    price: parseFloat(singleUnitPrice.toFixed(2))
                });
            }
        }

        item.productVolumes = volumeOptions;
    }

    return items;
};

/**
 * Fetch assigned orders for delivery boy
 */
export const getMyAssignedOrdersService = async ({ deliveryBoyId, query }) => {
    const { status, search, date } = query;

    const whereClause = { deliveryBoyId };
    const orderIncludeWhere = {};

    let todayStart, todayEnd;
    if (date) {
        const selectDate = new Date(date);
        const year = selectDate.getFullYear();
        const month = selectDate.getMonth();
        const day = selectDate.getDate();
        const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
        todayStart = new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET_MS);
        todayEnd = new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET_MS);
    } else {
        const todayRange = getTodayRangeIST();
        todayStart = todayRange.todayStart;
        todayEnd = todayRange.todayEnd;
    }

    if (status) {
        if (status === 'Cancelled') {
            whereClause['$order.orderStatus$'] = { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] };
            orderIncludeWhere.updatedAt = { [Op.between]: [todayStart, todayEnd] };
        } else if (status === 'Completed') {
            whereClause['$order.orderStatus$'] = { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] };
            orderIncludeWhere.updatedAt = { [Op.between]: [todayStart, todayEnd] };
        } else if (status === 'Assigned' || status === 'Pending') {
            whereClause.status = status;
            orderIncludeWhere.orderStatus = {
                [Op.notIn]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
            };
            if (date) {
                orderIncludeWhere.createdAt = { [Op.between]: [todayStart, todayEnd] };
            }
        } else {
            whereClause.status = status;
        }
    } else {
        whereClause[Op.or] = [
            {
                status: { [Op.in]: ['Pending', 'Assigned'] },
                '$order.orderStatus$': {
                    [Op.notIn]: ['Delivered', 'Payment Collect', 'Payment Verify', 'Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel']
                }
            },
            {
                '$order.orderStatus$': { [Op.in]: ['Delivered', 'Payment Collect', 'Payment Verify'] },
                '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
            },
            {
                '$order.orderStatus$': { [Op.in]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] },
                '$order.updatedAt$': { [Op.between]: [todayStart, todayEnd] }
            }
        ];
    }

    if (search) {
        orderIncludeWhere.orderId = { [Op.iLike]: `%${search}%` };
    }

    const pagination = getPaginationOptions(query);
    const { limit, offset, page } = pagination;

    const result = await OrderAssignment.findAndCountAll({
        where: whereClause,
        attributes: { exclude: ['orderId'] },
        include: [
            {
                model: Order,
                as: 'order',
                where: Object.keys(orderIncludeWhere).length > 0 ? orderIncludeWhere : null,
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'latitude', 'longitude', 'creditline', 'advanceJama', 'balanceType', 'blockcredit'],
                        include: [
                            {
                                model: BusinessProfile,
                                as: 'businessProfile',
                                attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                            }
                        ]
                    }
                ]
            }
        ],
        ...(query.paginate !== 'false' ? { limit, offset } : {}),
        order: [['position', 'ASC'], ['assignedAt', 'ASC']],
        subQuery: false
    });

    if (result.rows.length > 0) {
        const orderIds = result.rows.map(item => item.order?.id).filter(Boolean);
        const userIds = Array.from(new Set(result.rows.map(item => item.order?.userId).filter(Boolean)));
        const customerPhones = Array.from(new Set(result.rows.map(item => {
            const p = item.order?.user?.number || item.order?.customerNumber;
            return p ? String(p).replace(/\D/g, '').slice(-10) : '';
        }).filter(p => p && p.length >= 7)));

        let items = [];
        let payments = [];
        let returns = [];
        let candidateOrders = [];
        let unsettledPastReturns = [];

        const fetchPromises = [];

        if (orderIds.length > 0) {
            fetchPromises.push(
                OrderItem.findAll({
                    where: { orderId: orderIds },
                    include: [
                        { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                        {
                            model: ProductVariant,
                            as: 'variant',
                            include: [{ model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }]
                        }
                    ]
                }).then(res => { items = res; }),

                OrderPayment.findAll({
                    where: { orderId: orderIds },
                    attributes: ['id', 'orderId', 'amount', 'paymentMethod', 'notes', 'createdAt']
                }).then(res => { payments = res; }),

                SalesReturn.findAll({
                    where: {
                        orderId: orderIds,
                        status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                    }
                }).then(res => { returns = res; })
            );
        }

        const userConditions = [];
        if (userIds.length > 0) userConditions.push({ userId: { [Op.in]: userIds } });
        if (customerPhones.length > 0) {
            userConditions.push({
                [Op.or]: customerPhones.map(cp => ({ customerNumber: { [Op.like]: `%${cp}` } }))
            });
        }

        if (userConditions.length > 0) {
            fetchPromises.push(
                Order.findAll({
                    where: {
                        [Op.or]: userConditions,
                        orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
                    },
                    include: [
                        {
                            model: OrderPayment,
                            as: 'payments',
                            required: false,
                            attributes: ['id', 'orderId', 'amount', 'paymentMethod']
                        }
                    ],
                    attributes: ['id', 'orderId', 'userId', 'customerNumber', 'totalAmount', 'couponDiscount', 'paidAmount', 'dueAmount', 'paymentStatus', 'orderStatus', 'createdAt'],
                    order: [['createdAt', 'DESC']]
                }).then(res => { candidateOrders = res; })
            );

            if (userIds.length > 0) {
                fetchPromises.push(
                    SalesReturn.findAll({
                        where: {
                            userId: { [Op.in]: userIds },
                            creditProcessed: false,
                            orderId: { [Op.notIn]: orderIds },
                            status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
                        }
                    }).then(res => { unsettledPastReturns = res; })
                );
            }
        }

        await Promise.all(fetchPromises);

        const itemsMap = {};
        items.forEach(item => {
            if (!itemsMap[item.orderId]) itemsMap[item.orderId] = [];
            itemsMap[item.orderId].push(item);
        });

        const paymentsMap = {};
        payments.forEach(p => {
            if (!paymentsMap[p.orderId]) paymentsMap[p.orderId] = [];
            paymentsMap[p.orderId].push(p);
        });

        const returnsMap = {};
        returns.forEach(r => {
            if (!returnsMap[r.orderId]) returnsMap[r.orderId] = [];
            returnsMap[r.orderId].push(r);
        });

        const unsettledReturnsMap = {};
        unsettledPastReturns.forEach(r => {
            if (!unsettledReturnsMap[r.userId]) unsettledReturnsMap[r.userId] = 0;
            unsettledReturnsMap[r.userId] += parseFloat(r.returnAmount || 0);
        });

        result.rows.forEach(item => {
            if (item.order) {
                const rawItems = itemsMap[item.order.id] || [];
                const formattedItems = rawItems.map(it => {
                    const itemData = it.toJSON ? it.toJSON() : it;
                    if (itemData.variantInfo) {
                        if (typeof itemData.variantInfo.volume === 'object' && itemData.variantInfo.volume !== null) {
                            itemData.variantInfo.volume = Object.values(itemData.variantInfo.volume)[0] || '';
                        }
                        if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
                        if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
                    }
                    return itemData;
                });
                item.order.setDataValue('items', formattedItems);
                item.order.setDataValue('payments', paymentsMap[item.order.id] || []);
                item.order.setDataValue('returns', returnsMap[item.order.id] || []);
            }
        });

        let responseData;
        if (query.paginate !== 'false') {
            responseData = formatPaginatedResponse(result, page, limit);
        } else {
            responseData = {
                totalRecords: result.count,
                data: result.rows
            };
        }

        if (responseData.data) {
            responseData.data = responseData.data.map(item => {
                const data = item.toJSON ? item.toJSON() : item;
                if (data.order && data.order.orderStatus === 'Cancelled') {
                    data.status = 'Cancelled';
                }

                const uId = data.order?.userId;
                const userPhoneClean = data.order?.user?.number
                    ? String(data.order.user.number).replace(/\D/g, '').slice(-10)
                    : (data.order?.customerNumber ? String(data.order.customerNumber).replace(/\D/g, '').slice(-10) : '');
                const currentOrderDbId = data.order?.id;
                const currentOrderNum = parseInt(String(data.order?.orderId || '').replace(/\D/g, ''), 10) || 0;
                const currentOrderCreated = data.order?.createdAt ? new Date(data.order.createdAt).getTime() : Date.now();

                let pastDueOrders = [];
                let unpaidOrdersSum = 0;

                candidateOrders.forEach(uo => {
                    if (String(uo.id) === String(currentOrderDbId)) return;

                    let isMatch = false;
                    if (uId && uo.userId && String(uId) === String(uo.userId)) {
                        isMatch = true;
                    } else if (userPhoneClean && userPhoneClean.length >= 7) {
                        const uoPhone = String(uo.customerNumber || '').replace(/\D/g, '').slice(-10);
                        if (uoPhone && uoPhone === userPhoneClean) isMatch = true;
                    }

                    if (!isMatch) return;

                    const uoOrderNum = parseInt(String(uo.orderId || '').replace(/\D/g, ''), 10) || 0;
                    const uoTime = new Date(uo.createdAt).getTime();
                    const isEarlier = (uoOrderNum > 0 && currentOrderNum > 0)
                        ? (uoOrderNum < currentOrderNum)
                        : (uoTime <= currentOrderCreated);

                    if (!isEarlier) return;

                    const fin = calculateOrderFinancials(uo, uo.payments);
                    const due = fin.paymentStatus !== 'Paid' ? parseFloat(fin.dueAmount) : 0;

                    if (due > 0) {
                        unpaidOrdersSum += due;
                        pastDueOrders.push({
                            id: uo.id,
                            orderId: uo.orderId,
                            totalAmount: fin.totalAmount,
                            couponDiscount: fin.couponDiscount,
                            paidAmount: parseFloat(fin.paidAmount),
                            dueAmount: due,
                            paymentStatus: fin.paymentStatus,
                            orderStatus: uo.orderStatus,
                            createdAt: uo.createdAt
                        });
                    }
                });

                const directReturns = (returnsMap[data.order?.id] || []).filter(r => r.status !== 'Rejected' && r.status !== 'Cancelled');
                const directReturnAmount = directReturns.reduce((sum, r) => sum + parseFloat(r.returnAmount || 0), 0);
                const unsettledPastReturnAmount = uId ? (unsettledReturnsMap[uId] || 0) : 0;
                const totalSalesReturnDeduction = Math.round(directReturnAmount + unsettledPastReturnAmount);

                const userAdvanceJama = parseFloat(data.order?.user?.advanceJama || 0);
                const userCreditVal = parseFloat(data.order?.user?.creditline || 0);
                const userBalanceType = data.order?.user?.balanceType || (userAdvanceJama > 0 ? 'JAMA' : (userCreditVal > 0 || unpaidOrdersSum > 0 ? 'DUE' : 'CLEAR'));
                const jamaAmountVal = (userBalanceType === 'JAMA' && userAdvanceJama > 0) ? userAdvanceJama : 0;

                let totalPastDueAmount = 0;
                if (unpaidOrdersSum > 0) {
                    totalPastDueAmount = unpaidOrdersSum;
                } else if (userBalanceType === 'DUE' && userCreditVal > 0) {
                    totalPastDueAmount = userCreditVal;
                }

                const currentPayments = paymentsMap[data.order?.id] || [];
                const currentFin = calculateOrderFinancials(data.order, currentPayments);
                const fullTotal = currentFin.totalAmount;
                const savedCouponDisc = currentFin.couponDiscount;
                const payableAmt = currentFin.netPayable;
                const paidAmount = parseFloat(currentFin.paidAmount);
                const calculatedDueAmt = parseFloat(currentFin.dueAmount);
                const savedCouponPts = Number(data.order?.couponPoints || 0);

                const roundedFullTotal = Math.round(parseFloat(fullTotal || 0));
                const netOrderCollectible = Math.max(0, Math.round(calculatedDueAmt) - totalSalesReturnDeduction);
                const totalDueAmt = parseFloat(totalPastDueAmount) + netOrderCollectible;
                const netPayableVal = Math.max(0, totalDueAmt);
                const isDelivered = ['Delivered', 'Payment Collect', 'Payment Verify', 'Completed'].includes(data.order?.orderStatus);

                data.pastDueOrders = pastDueOrders;
                data.totalPastDueAmount = totalPastDueAmount.toFixed(2);
                data.duePayment = totalPastDueAmount.toFixed(2);
                data.pastDueAmount = totalPastDueAmount.toFixed(2);
                data.previousUnpaidDue = totalPastDueAmount.toFixed(2);
                data.dueAmount = isDelivered ? calculatedDueAmt.toFixed(2) : totalPastDueAmount.toFixed(2);
                data.currentPayment = netOrderCollectible.toFixed(2);
                data.netPayableAmount = netPayableVal.toFixed(2);
                data.totalAmount = isDelivered ? payableAmt.toFixed(2) : netPayableVal.toFixed(2);
                data.jamaAmount = jamaAmountVal.toFixed(2);
                data.userCreditline = userCreditVal.toFixed(2);
                data.advanceJama = userAdvanceJama.toFixed(2);
                data.balanceType = userBalanceType;
                data.salesReturnCalculation = {
                    billAmount: roundedFullTotal,
                    returnAmount: totalSalesReturnDeduction,
                    netToCollect: netOrderCollectible
                };

                if (data.order) {
                    data.order.couponPoints = savedCouponPts;
                    data.order.couponDiscount = savedCouponDisc.toFixed(2);
                    data.order.discountType = (savedCouponPts > 0 || savedCouponDisc > 0) ? (data.order.discountType || 'Coupon Discount') : null;
                    data.order.payableAmount = payableAmt.toFixed(2);
                    data.order.paidAmount = paidAmount.toFixed(2);
                    data.order.totalAmount = fullTotal.toFixed(2);
                    data.order.paymentStatus = currentFin.paymentStatus;
                    data.order.netPayableAmount = netOrderCollectible.toFixed(2);
                    data.order.totalPastDueAmount = totalPastDueAmount.toFixed(2);
                    data.order.duePayment = totalPastDueAmount.toFixed(2);
                    data.order.pastDueAmount = totalPastDueAmount.toFixed(2);
                    data.order.previousUnpaidDue = totalPastDueAmount.toFixed(2);
                    data.order.pendingDue = totalPastDueAmount.toFixed(2);
                    data.order.dueAmount = isDelivered ? calculatedDueAmt.toFixed(2) : totalPastDueAmount.toFixed(2);
                    data.order.salesReturnCalculation = data.salesReturnCalculation;

                    if (data.order.user) {
                        data.order.user.shopName = data.order.user.businessProfile?.shopName || '';
                        data.order.user.shopAddress = data.order.user.businessProfile?.shopAddress || '';
                        data.order.user.creditline = userCreditVal.toFixed(2);
                        data.order.user.advanceJama = userAdvanceJama.toFixed(2);
                        data.order.user.balanceType = userBalanceType;
                        data.order.user.jamaAmount = jamaAmountVal.toFixed(2);
                        data.order.user.totalPastDueAmount = totalPastDueAmount.toFixed(2);
                        data.order.user.previousUnpaidDue = totalPastDueAmount.toFixed(2);
                    }
                }

                return data;
            });
        }

        return responseData;
    }

    let responseData;
    if (query.paginate !== 'false') {
        responseData = formatPaginatedResponse(result, page, limit);
    } else {
        responseData = {
            totalRecords: result.count,
            data: result.rows
        };
    }
    return responseData;
};

/**
 * Get comprehensive assignment details with past due calculation and product volume enrichment
 */
export const getAssignmentDetailsService = async ({ assignmentId, deliveryBoyId }) => {
    const assignment = await OrderAssignment.findOne({
        where: { id: assignmentId, deliveryBoyId },
        attributes: { exclude: ['orderId'] },
        include: [
            {
                model: Order,
                as: 'order',
                include: [
                    {
                        model: User,
                        as: 'user',
                        attributes: ['id', 'fullname', 'number', 'city', 'postcode', 'latitude', 'longitude', 'creditline', 'blockcredit', 'advanceJama', 'balanceType'],
                        include: [
                            {
                                model: BusinessProfile,
                                as: 'businessProfile',
                                attributes: ['id', 'shopName', 'shopAddress', 'postcode']
                            }
                        ]
                    },
                    { model: OrderPayment, as: 'payments' },
                    {
                        model: OrderItem,
                        as: 'items',
                        include: [
                            { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail', 'hasCoupon', 'couponPoints', 'couponPrice'] },
                            {
                                model: ProductVariant,
                                as: 'variant',
                                include: [
                                    { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                                ]
                            }
                        ]
                    },
                    {
                        model: SalesReturn,
                        as: 'returns',
                        required: false
                    }
                ]
            }
        ]
    });

    if (!assignment) return null;

    const userId = assignment.order?.userId;
    const userPhoneClean = assignment.order?.user?.number ? String(assignment.order.user.number).replace(/\D/g, '').slice(-10) : '';
    const currentOrderDbId = assignment.order?.id;
    const currentOrderNum = parseInt(String(assignment.order?.orderId || '').replace(/\D/g, ''), 10) || 0;
    const currentOrderCreated = assignment.order?.createdAt ? new Date(assignment.order.createdAt).getTime() : Date.now();

    let pastDueOrders = [];
    let unpaidOrdersSum = 0;

    if (userId || userPhoneClean) {
        const userOrConditions = [];
        if (userId) userOrConditions.push({ userId });
        if (userPhoneClean && userPhoneClean.length >= 7) {
            userOrConditions.push({ customerNumber: { [Op.like]: `%${userPhoneClean}` } });
        }

        const candidateOrders = await Order.findAll({
            where: {
                [Op.or]: userOrConditions,
                id: { [Op.ne]: currentOrderDbId },
                orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
            },
            include: [
                {
                    model: OrderPayment,
                    as: 'payments',
                    required: false,
                    attributes: ['id', 'amount', 'paymentMethod']
                }
            ],
            attributes: ['id', 'orderId', 'totalAmount', 'couponDiscount', 'paidAmount', 'dueAmount', 'paymentStatus', 'orderStatus', 'createdAt'],
            order: [['createdAt', 'DESC']]
        });

        candidateOrders.forEach(uo => {
            const uoOrderNum = parseInt(String(uo.orderId || '').replace(/\D/g, ''), 10) || 0;
            const uoTime = new Date(uo.createdAt).getTime();
            const isEarlier = (uoOrderNum > 0 && currentOrderNum > 0)
                ? (uoOrderNum < currentOrderNum)
                : (uoTime <= currentOrderCreated);

            if (!isEarlier) return;

            const fin = calculateOrderFinancials(uo, uo.payments);
            const due = fin.paymentStatus !== 'Paid' ? parseFloat(fin.dueAmount) : 0;

            if (due > 0) {
                unpaidOrdersSum += due;
                pastDueOrders.push({
                    id: uo.id,
                    orderId: uo.orderId,
                    totalAmount: fin.totalAmount,
                    couponDiscount: fin.couponDiscount,
                    paidAmount: parseFloat(fin.paidAmount),
                    dueAmount: due,
                    paymentStatus: fin.paymentStatus,
                    orderStatus: uo.orderStatus,
                    createdAt: uo.createdAt
                });
            }
        });
    }

    const data = assignment.toJSON();

    if (data.order && data.order.user) {
        data.order.user.shopName = data.order.user.businessProfile?.shopName || '';
        data.order.user.shopAddress = data.order.user.businessProfile?.shopAddress || '';
    }

    const couponProducts = [];

    if (data.order && data.order.items) {
        data.order.items.forEach(itemData => {
            const p = itemData.product || {};
            const isItemCouponApplied = itemData.hasCoupon === true || itemData.hasCoupon === 'true';
            
            itemData.hasCoupon = isItemCouponApplied;
            itemData.couponPoints = isItemCouponApplied ? Number(itemData.couponPoints || 0) : 0;
            itemData.couponPrice = isItemCouponApplied ? parseFloat(itemData.couponPrice || 0).toFixed(2) : "0.00";

            if (itemData.variantInfo) {
                if (typeof itemData.variantInfo.volume === 'object' && itemData.variantInfo.volume !== null) {
                    itemData.variantInfo.volume = Object.values(itemData.variantInfo.volume)[0] || '';
                }
                if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
                if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
            }

            const masterHasCoupon = p.hasCoupon === true || p.hasCoupon === 'true';
            if (masterHasCoupon) {
                const masterPts = Number(p.couponPoints || 0);
                const masterPrice = Number(p.couponPrice || 0);

                let pName = p.name;
                if (typeof pName === 'object' && pName !== null) {
                    pName = pName.en || Object.values(pName)[0] || 'Product';
                }

                couponProducts.push({
                    id: itemData.productId,
                    itemId: itemData.id,
                    name: pName || itemData.productName || 'Product',
                    image: p.thumbnail || '',
                    couponPoints: masterPts,
                    couponPrice: masterPrice.toFixed(2)
                });
            }
        });
        await enrichItemsWithProductVolumes(data.order.items);
    }

    const currentFin = calculateOrderFinancials(assignment.order, assignment.order?.payments);
    const fullTotal = currentFin.totalAmount;
    const savedCouponDisc = currentFin.couponDiscount;
    const payableAmt = currentFin.netPayable;
    const paidAmount = parseFloat(currentFin.paidAmount);
    const calculatedDueAmt = parseFloat(currentFin.dueAmount);
    const savedCouponPts = Number(assignment.order?.couponPoints || 0);

    delete data.payableAmount;

    if (data.order) {
        data.order.couponPoints = savedCouponPts;
        data.order.couponDiscount = savedCouponDisc.toFixed(2);
        data.order.discountType = (savedCouponPts > 0 || savedCouponDisc > 0) ? (assignment.order?.discountType || 'Coupon Discount') : null;
        data.order.couponProducts = couponProducts;
        data.order.payableAmount = payableAmt.toFixed(2);
        data.order.paidAmount = paidAmount.toFixed(2);
        data.order.dueAmount = calculatedDueAmt.toFixed(2);
        data.order.totalAmount = fullTotal.toFixed(2);
    }

    if (data.order && data.order.payments) {
        const payments = data.order.payments || [];
        const totalCredit = payments.filter(p => p.paymentMethod === 'CREDIT').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const totalReal = payments.filter(p => p.paymentMethod === 'CASH' || p.paymentMethod === 'ONLINE').reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
        const orderTotal = parseFloat(data.order.totalAmount || 0);

        const nonCreditPortion = Math.max(0, orderTotal - totalCredit);
        const realPaidToCredit = Math.max(0, totalReal - nonCreditPortion);
        const outstandingCredit = Math.max(0, totalCredit - realPaidToCredit);

        let remainingCreditToDistribute = outstandingCredit;
        for (const payment of payments) {
            if (payment.paymentMethod === 'CREDIT') {
                const currentAmount = parseFloat(payment.amount || 0);
                const allowedAmount = Math.min(currentAmount, remainingCreditToDistribute);
                payment.amount = allowedAmount.toFixed(2);
                remainingCreditToDistribute -= allowedAmount;
            }
        }
        data.order.payments = payments;
    }

    const orderReturns = (assignment.order?.returns || []).filter(r => r.status !== 'Rejected' && r.status !== 'Cancelled');
    const directReturnAmount = orderReturns.reduce((sum, r) => sum + parseFloat(r.returnAmount || 0), 0);

    let unsettledPastReturnAmount = 0;
    if (userId) {
        const unsettledReturns = await SalesReturn.findAll({
            where: {
                userId,
                creditProcessed: false,
                orderId: { [Op.ne]: assignment.order.id },
                status: { [Op.notIn]: ['Rejected', 'Cancelled'] }
            }
        });
        unsettledPastReturnAmount = unsettledReturns.reduce((sum, r) => sum + parseFloat(r.returnAmount || 0), 0);
    }

    const totalSalesReturnDeduction = Math.round(directReturnAmount + unsettledPastReturnAmount);

    const userAdvanceJama = parseFloat(assignment.order?.user?.advanceJama || 0);
    const userCreditVal = parseFloat(assignment.order?.user?.creditline || 0);
    const userBalanceType = assignment.order?.user?.balanceType || (userAdvanceJama > 0 ? 'JAMA' : (userCreditVal > 0 || unpaidOrdersSum > 0 ? 'DUE' : 'CLEAR'));
    const jamaAmountVal = (userBalanceType === 'JAMA' && userAdvanceJama > 0) ? userAdvanceJama : 0;

    let totalPastDueAmount = 0;
    if (unpaidOrdersSum > 0) {
        totalPastDueAmount = unpaidOrdersSum;
    } else if (userBalanceType === 'DUE' && userCreditVal > 0) {
        totalPastDueAmount = userCreditVal;
    }

    const roundedFullTotal = Math.round(parseFloat(fullTotal || 0));
    const netOrderCollectible = Math.max(0, Math.round(calculatedDueAmt) - totalSalesReturnDeduction);
    const totalDueAmt = parseFloat(totalPastDueAmount) + netOrderCollectible;
    const netPayableVal = Math.max(0, totalDueAmt);

    data.pastDueOrders = pastDueOrders;
    data.totalPastDueAmount = totalPastDueAmount.toFixed(2);
    data.duePayment = totalPastDueAmount.toFixed(2);
    data.pastDueAmount = totalPastDueAmount.toFixed(2);
    data.currentPayment = netOrderCollectible.toFixed(2);
    data.netPayableAmount = netPayableVal.toFixed(2);
    data.totalAmount = netPayableVal.toFixed(2);
    data.jamaAmount = jamaAmountVal.toFixed(2);
    data.userCreditline = userCreditVal.toFixed(2);
    data.advanceJama = userAdvanceJama.toFixed(2);
    data.balanceType = userBalanceType;
    data.salesReturnCalculation = {
        billAmount: roundedFullTotal,
        returnAmount: totalSalesReturnDeduction,
        netToCollect: netOrderCollectible
    };

    if (data.order) {
        data.order.netPayableAmount = netOrderCollectible.toFixed(2);
        data.order.payableAmount = netOrderCollectible.toFixed(2);
        data.order.dueAmount = netOrderCollectible.toFixed(2);
        data.order.totalPastDueAmount = totalPastDueAmount.toFixed(2);
        data.order.duePayment = totalPastDueAmount.toFixed(2);
        data.order.salesReturnCalculation = data.salesReturnCalculation;
    }

    if (data.order && data.order.user) {
        data.order.user.creditline = userCreditVal.toFixed(2);
        data.order.user.advanceJama = userAdvanceJama.toFixed(2);
        data.order.user.balanceType = userBalanceType;
        data.order.user.jamaAmount = jamaAmountVal.toFixed(2);
    }

    return data;
};

/**
 * Get user previous bills for settlement modal
 */
export const getUserPreviousBillsService = async ({ userId, currentOrderId }) => {
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    let user = null;
    if (uuidPattern.test(userId)) {
        user = await User.findByPk(userId, {
            attributes: ['id', 'fullname', 'number', 'creditline'],
            include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress'] }]
        });
    }

    if (!user) {
        const cleanPhone = String(userId).replace(/\D/g, '').slice(-10);
        if (cleanPhone.length >= 7) {
            user = await User.findOne({
                where: { number: { [Op.like]: `%${cleanPhone}` } },
                attributes: ['id', 'fullname', 'number', 'creditline'],
                include: [{ model: BusinessProfile, as: 'businessProfile', attributes: ['shopName', 'shopAddress'] }]
            });
        }
    }

    const whereConditions = [];
    if (user) {
        whereConditions.push({ userId: user.id });
    }
    const cleanPhone = user?.number ? String(user.number).replace(/\D/g, '').slice(-10) : String(userId).replace(/\D/g, '').slice(-10);
    if (cleanPhone.length >= 7) {
        whereConditions.push({ customerNumber: { [Op.like]: `%${cleanPhone}` } });
    }

    if (whereConditions.length === 0) {
        return null;
    }

    const orderWhere = {
        [Op.or]: whereConditions,
        orderStatus: { [Op.notIn]: ['Cancelled', 'Admin Cancel', 'User Cancel', 'Delivery Boy Cancel'] }
    };

    if (currentOrderId) {
        const isUuid = uuidPattern.test(currentOrderId);
        if (isUuid) {
            orderWhere.id = { [Op.ne]: currentOrderId };
        } else {
            orderWhere.orderId = { [Op.ne]: currentOrderId };
        }
    }

    const orders = await Order.findAll({
        where: orderWhere,
        attributes: [
            'id', 'orderId', 'totalAmount', 'couponPoints', 'couponDiscount', 
            'discountType', 'paidAmount', 'dueAmount', 'paymentStatus', 
            'paymentMethod', 'orderStatus', 'createdAt', 'deliveredAt'
        ],
        include: [
            {
                model: OrderPayment,
                as: 'payments',
                attributes: ['id', 'amount', 'paymentMethod', 'notes', 'createdAt']
            },
            {
                model: OrderItem,
                as: 'items',
                attributes: ['id', 'productId', 'variantId', 'quantity', 'price', 'sellUnit', 'variantInfo', 'hasCoupon', 'couponPoints', 'couponPrice'],
                include: [
                    { model: Product, as: 'product', attributes: ['id', 'name', 'thumbnail'] },
                    {
                        model: ProductVariant,
                        as: 'variant',
                        attributes: ['id', 'volume', 'volumeId', 'baseUnitsPerPack', 'sellingVolume', 'purchasePrice'],
                        include: [
                            { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                            { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                        ]
                    }
                ]
            }
        ],
        order: [['createdAt', 'DESC']]
    });

    const previousBills = [];

    for (const ord of orders) {
        const ordData = ord.toJSON ? ord.toJSON() : ord;
        const fin = calculateOrderFinancials(ordData, ordData.payments);

        const isPaid = fin.paymentStatus === 'Paid';
        const displayDue = isPaid ? '0.00' : fin.dueAmount;
        const displayPaid = isPaid ? fin.payableAmount : fin.paidAmount;

        const couponDiscNum = fin.couponDiscount;
        const couponPtsNum = Number(ordData.couponPoints || 0);

        if (ordData.items && ordData.items.length > 0) {
            ordData.items.forEach(itemData => {
                if (itemData.variantInfo) {
                    if (typeof itemData.variantInfo.volume === 'object' && itemData.variantInfo.volume !== null) {
                        itemData.variantInfo.volume = Object.values(itemData.variantInfo.volume)[0] || '';
                    }
                    if (itemData.variantInfo.extra === undefined) itemData.variantInfo.extra = '';
                    if (itemData.variantInfo.extraName === undefined) itemData.variantInfo.extraName = '';
                }
            });
            await enrichItemsWithProductVolumes(ordData.items);
        }

        const formattedItems = (ordData.items || []).map(item => {
            let pName = item.product?.name;
            if (typeof pName === 'object' && pName !== null) {
                pName = pName.en || Object.values(pName)[0] || 'Product';
            }
            const vol = item.variant?.volumeRef?.name || item.variant?.volume || item.variantInfo?.volume || 'Unit';
            const volStr = typeof vol === 'object' ? (vol.en || Object.values(vol)[0] || 'Unit') : (vol || 'Unit');

            return {
                id: item.id,
                orderId: ordData.id,
                productId: item.productId,
                variantId: item.variantId,
                name: pName || item.productName || 'Product',
                productName: pName || item.productName || 'Product',
                product: item.product,
                variant: item.variant,
                variantInfo: item.variantInfo,
                quantity: item.quantity,
                price: item.price,
                sellUnit: item.sellUnit || 'Box',
                volume: volStr,
                baseUnitsPerPack: item.baseUnitsPerPack || 1,
                sellingVolume: item.sellingVolume || 1,
                packUnits: item.packUnits || 1,
                singleUnitPrice: item.singleUnitPrice || parseFloat(item.price || 0),
                unitPrice: item.unitPrice || item.singleUnitPrice || parseFloat(item.price || 0),
                totalUnits: item.totalUnits || item.quantity,
                productVolumes: item.productVolumes || [],
                image: item.product?.thumbnail || '',
                thumbnail: item.product?.thumbnail || '',
                hasCoupon: item.hasCoupon || false,
                couponPoints: item.couponPoints || 0,
                couponPrice: item.couponPrice || '0.00'
            };
        });

        previousBills.push({
            id: ordData.id,
            orderId: ordData.orderId,
            billNo: ordData.orderId,
            orderStatus: ordData.orderStatus,
            paymentStatus: fin.paymentStatus,
            paymentMethod: ordData.paymentMethod || 'PENDING',
            totalAmount: fin.totalAmount.toFixed(2),
            couponDiscount: couponDiscNum.toFixed(2),
            couponPoints: couponPtsNum,
            discountType: (couponPtsNum > 0 || couponDiscNum > 0) ? (ordData.discountType || 'Coupon Discount') : null,
            payableAmount: fin.payableAmount,
            paidAmount: displayPaid,
            dueAmount: displayDue,
            createdAt: ordData.createdAt,
            deliveredAt: ordData.deliveredAt || ordData.createdAt,
            items: formattedItems
        });
    }


    previousBills.sort((a, b) => {
        const dateDiff = new Date(b.createdAt) - new Date(a.createdAt);
        if (dateDiff !== 0) return dateDiff;
        const numA = parseInt(String(a.billNo || '').replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(String(b.billNo || '').replace(/\D/g, ''), 10) || 0;
        return numB - numA;
    });

    const latest5Bills = previousBills.slice(0, 5);

    return {
        user: {
            id: user?.id || userId,
            fullname: user?.fullname || 'Customer',
            shopName: user?.businessProfile?.shopName || '',
            number: user?.number || cleanPhone,
            creditline: parseFloat(user?.creditline || 0)
        },
        totalBillsCount: latest5Bills.length,
        previousBills: latest5Bills
    };
};

/**
 * Reorder delivery assignments positions
 */
export const reorderAssignmentsService = async ({ deliveryBoyId, id, fromIndex, toIndex }) => {
    const transaction = await OrderAssignment.sequelize.transaction();
    try {
        if (fromIndex === toIndex) {
            await transaction.commit();
            return true;
        }

        if (toIndex < fromIndex) {
            await OrderAssignment.increment('position', {
                by: 1,
                where: {
                    deliveryBoyId,
                    position: { [Op.gte]: toIndex, [Op.lt]: fromIndex }
                },
                transaction
            });
        } else {
            await OrderAssignment.increment('position', {
                by: -1,
                where: {
                    deliveryBoyId,
                    position: { [Op.gt]: fromIndex, [Op.lte]: toIndex }
                },
                transaction
            });
        }

        await OrderAssignment.update(
            { position: toIndex },
            { where: { id, deliveryBoyId }, transaction }
        );

        await transaction.commit();
        return true;
    } catch (error) {
        if (transaction) await transaction.rollback();
        throw error;
    }
};

/**
 * Update assignment status (e.g. Cancelled / Completed) with inventory and notice sync
 */
export const updateMyAssignmentStatusService = async ({ assignmentId, deliveryBoyId, status, notes, reqUser }) => {
    const noteText = String(notes || '').trim();

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assignmentId);
    const whereConditions = [{ id: assignmentId }];
    if (isUuid) whereConditions.push({ orderId: assignmentId });

    const assignment = await OrderAssignment.findOne({
        where: {
            deliveryBoyId,
            [Op.or]: whereConditions
        }
    });

    if (!assignment) {
        let order = null;
        if (isUuid) {
            order = await Order.findByPk(assignmentId, { include: [{ model: OrderItem, as: 'items' }] });
        } else {
            order = await Order.findOne({ where: { orderId: assignmentId }, include: [{ model: OrderItem, as: 'items' }] });
        }

        if (!order) return null;

        if (status === 'Cancelled') {
            const prevStatus = order.orderStatus;
            order.orderStatus = 'Delivery Boy Cancel';
            order.dueAmount = 0;
            order.notes = order.notes ? `${order.notes}\n[Delivery Boy Cancelled]: ${notes || 'Refused'}` : `[Delivery Boy Cancelled]: ${notes || 'Refused'}`;
            await order.save();

            if (prevStatus === 'Shipping') {
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
                        reason: 'Cancelled after shipping (Delivery Boy)',
                        status: 'Pending'
                    });
                    totalReturnAmount += returnAmount;
                    await OrderItem.destroy({ where: { id: item.id } });
                }
                const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                let newSubtotal = 0;
                for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                await order.save();
            }

            const OrderAssignmentModel = order.sequelize.models.OrderAssignment;
            if (OrderAssignmentModel) {
                await OrderAssignmentModel.update(
                    { status: 'Cancelled', notes: notes || 'Cancelled by Delivery Boy' },
                    { where: { orderId: order.id } }
                );
            }

            if (order.userId) await syncPartyDeliveryNotice(order.userId);
        } else if (status === 'Completed') {
            order.orderStatus = 'Delivered';
            order.deliveredAt = order.deliveredAt || new Date();
            await order.save();
            await sendDeliveredNotification(order.id);
            if (order.userId) await syncPartyDeliveryNotice(order.userId);
        }

        return { order };
    }

    await assignment.update({ status, notes: noteText || assignment.notes });

    if (status === 'Cancelled') {
        const order = await Order.findByPk(assignment.orderId, {
            include: [{ model: OrderItem, as: 'items' }]
        });
        if (order) {
            const prevStatus = order.orderStatus;
            order.orderStatus = 'Delivery Boy Cancel';
            order.dueAmount = 0;
            order.notes = order.notes ? `${order.notes}\n[Delivery Boy Cancelled]: ${notes || 'Refused'}` : `[Delivery Boy Cancelled]: ${notes || 'Refused'}`;
            await order.save();

            if (prevStatus === 'Shipping') {
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
                        reason: 'Cancelled after shipping (Delivery Boy)',
                        status: 'Pending'
                    });
                    totalReturnAmount += returnAmount;
                    await OrderItem.destroy({ where: { id: item.id } });
                }
                const remainingItems = await OrderItem.findAll({ where: { orderId: order.id } });
                let newSubtotal = 0;
                for (const it of remainingItems) newSubtotal += Number(it.price) * Number(it.quantity);
                order.totalAmount = roundTotal(newSubtotal + (Number(order.deliveryCharge) || 0));
                order.dueAmount = Math.max(0, order.dueAmount - totalReturnAmount);
                await order.save();
            }
            if (order.userId) await syncPartyDeliveryNotice(order.userId);
        }
    } else if (status === 'Completed') {
        const order = await Order.findByPk(assignment.orderId);
        if (order) {
            await order.update({
                orderStatus: 'Delivered',
                deliveredAt: order.deliveredAt || new Date(),
                notes: noteText || order.notes
            });
            if (order.userId) await syncPartyDeliveryNotice(order.userId);
        }
        await sendDeliveredNotification(assignment.orderId);
        try {
            const deliveredOrder = await Order.findByPk(assignment.orderId, {
                include: [
                    { model: User, as: 'user', attributes: ['id', 'fullname', 'number', 'city', 'routeCategoryId'] },
                    { model: OrderAssignment, as: 'assignment', include: [{ model: DeliveryBoy, as: 'deliveryBoy' }] }
                ]
            });
            if (deliveredOrder) {
                broadcastOrderDelivered({ order: deliveredOrder, deliveryBoyId });
            }
        } catch (sErr) {
            logger.error(`[Socket Broadcast Error in updateMyAssignmentStatusService]: ${sErr.message}`);
        }
    }

    return assignment;
};

export default {
    getMyAssignedOrdersService,
    getAssignmentDetailsService,
    getUserPreviousBillsService,
    enrichItemsWithProductVolumes,
    reorderAssignmentsService,
    updateMyAssignmentStatusService,
    sendDeliveredNotification
};
