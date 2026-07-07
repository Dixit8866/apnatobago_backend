import { Op } from 'sequelize';
import { InventoryStock, InventoryTransaction, Product, ProductVariant, MainCategory, SubCategory, CompanyCategory, Volume, ProductPricing, CustomLevel, Godown } from '../../models/index.js';
import { sendSuccessResponse, sendErrorResponse } from '../../utils/response.util.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import sequelize from '../../config/db.js';

// Simple round utility
const round2 = (num) => Math.round((num + Number.EPSILON) * 100) / 100;

/**
 * @desc    Get inventory (products with stock) for this godown
 * @route   GET /api/godown-panel/inventory
 * @access  Private (GodownStaff)
 */
export const getGodownInventory = async (req, res, next) => {
    try {
        const staff = req.user;
        const isSuperAdmin = staff.role === 'superadmin';
        const godownId = staff.godownId;

        const { search = '', status, mainCategoryId } = req.query;

        const trimmedSearch = String(search).trim();
        const searchTerms = trimmedSearch.split(/\s+/).filter(Boolean);
        const searchWhere = searchTerms.length > 0
            ? {
                [Op.and]: searchTerms.map(term => ({
                    [Op.or]: [
                        { 'name.en': { [Op.iLike]: `%${term}%` } },
                        { 'name.gu': { [Op.iLike]: `%${term}%` } },
                        { 'name.hn': { [Op.iLike]: `%${term}%` } },
                        { 'name.HN': { [Op.iLike]: `%${term}%` } },
                        { 'name.GU': { [Op.iLike]: `%${term}%` } },
                        { 'name.EN': { [Op.iLike]: `%${term}%` } },
                        sequelize.literal(`EXISTS (SELECT 1 FROM unnest("Product"."keywords") AS k WHERE k ILIKE ${sequelize.escape('%' + term + '%')})`)
                    ]
                }))
            }
            : {};

        const stockSubquery = `(
            SELECT COALESCE(SUM("stock"."totalBaseUnits"), 0)
            FROM "inventory_stocks" AS "stock"
            INNER JOIN "product_variants" AS "variant" ON "variant"."id" = "stock"."variantId"
            WHERE "variant"."productId" = "Product"."id"
              AND "stock"."status" = 'Active'
              AND "stock"."deletedAt" IS NULL
              AND "variant"."status" != 'Deleted'
              AND "variant"."deletedAt" IS NULL
              ${godownId ? `AND "stock"."godownId" = ${sequelize.escape(godownId)}` : ''}
        )`;

        const whereWithFilters = { ...searchWhere };
        whereWithFilters.status = { [Op.ne]: 'Deleted' };

        if (status === 'Active') {
            whereWithFilters[Op.and] = [
                ...(searchWhere[Op.and] || []),
                sequelize.literal(`${stockSubquery} > 0`)
            ];
        } else if (status === 'Inactive') {
            whereWithFilters[Op.and] = [
                ...(searchWhere[Op.and] || []),
                sequelize.literal(`${stockSubquery} = 0`)
            ];
        }

        if (mainCategoryId) {
            whereWithFilters.mainCategoryId = mainCategoryId;
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        // Count for status pills
        const countBaseWhere = { ...searchWhere };
        if (mainCategoryId) {
            countBaseWhere.mainCategoryId = mainCategoryId;
        }

        const [activeCount, inactiveCount, totalCount] = await Promise.all([
            Product.count({
                where: {
                    ...countBaseWhere,
                    status: { [Op.ne]: 'Deleted' },
                    [Op.and]: [
                        ...(countBaseWhere[Op.and] || []),
                        sequelize.literal(`${stockSubquery} > 0`)
                    ]
                }
            }),
            Product.count({
                where: {
                    ...countBaseWhere,
                    status: { [Op.ne]: 'Deleted' },
                    [Op.and]: [
                        ...(countBaseWhere[Op.and] || []),
                        sequelize.literal(`${stockSubquery} = 0`)
                    ]
                }
            }),
            Product.count({
                where: {
                    ...countBaseWhere,
                    status: { [Op.ne]: 'Deleted' }
                }
            })
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount };

        const { count, rows } = await Product.findAndCountAll({
            where: whereWithFilters,
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
                { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title'] },
                {
                    model: ProductVariant,
                    as: 'variants',
                    attributes: {
                        include: [
                            [
                                sequelize.literal(`(
                                    SELECT COALESCE(SUM("totalBaseUnits"), 0)
                                    FROM "inventory_stocks" AS "stock"
                                    WHERE "stock"."variantId" = "variants"."id"
                                      AND "stock"."status" = 'Active'
                                      AND "stock"."deletedAt" IS NULL
                                      ${godownId ? `AND "stock"."godownId" = ${sequelize.escape(godownId)}` : ''}
                                )`),
                                'totalStock'
                            ]
                        ]
                    },
                    required: false,
                    include: [
                        { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                        { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                        { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                    ]
                }
            ],
            limit,
            offset,
            order: [['createdAt', 'DESC']],
            distinct: true,
            subQuery: false
        });

        const responseData = formatPaginatedResponse({ count, rows }, page, limit);
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory fetched successfully.', {
            ...responseData,
            statusCounts
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get inventory summary for this godown
 * @route   GET /api/godown-panel/inventory/summary
 * @access  Private (GodownStaff)
 */
export const getGodownInventorySummary = async (req, res, next) => {
    try {
        const staff = req.user;
        const isSuperAdmin = staff.role === 'superadmin';
        const godownId = staff.godownId;

        const stocks = await InventoryStock.findAll({
            where: {
                status: { [Op.ne]: 'Deleted' },
                ...(godownId ? { godownId } : {})
            }
        });

        const totals = {
            totalSkus: stocks.length,
            totalBaseUnits: 0,
            totalStockValue: 0,
            lowStockCount: 0,
        };

        for (const stock of stocks) {
            const baseUnits = Number(stock.totalBaseUnits || 0);
            const avg = Number(stock.avgPurchasePricePerBaseUnit || 0);
            const stockValue = round2(baseUnits * avg);
            totals.totalBaseUnits += baseUnits;
            totals.totalStockValue += stockValue;
            if (baseUnits <= 10) totals.lowStockCount += 1;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory summary fetched successfully.', { totals });
    } catch (error) {
        next(error);
    }
};

/**
 * @desc    Get inventory transaction logs for this godown
 * @route   GET /api/godown-panel/inventory/logs
 * @access  Private (GodownStaff)
 */
export const getGodownInventoryLogs = async (req, res, next) => {
    try {
        const staff = req.user;
        const { page = 1, limit = 20, search = '', type = '' } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);

        const where = {
            ...(staff.godownId ? { godownId: staff.godownId } : {}),
            ...(type && { type }),
        };

        const { count, rows } = await InventoryTransaction.findAndCountAll({
            where,
            include: [
                {
                    model: Product,
                    as: 'product',
                    attributes: ['id', 'name', 'thumbnail'],
                    where: search ? { name: { [Op.iLike]: `%${search}%` } } : {},
                    required: search ? true : false,
                },
                {
                    model: ProductVariant,
                    as: 'variant',
                    attributes: ['id', 'volume', 'volumeId', 'extra', 'primaryUnitId', 'secondaryUnitId', 'secondaryPerPrimary'],
                    required: false,
                    include: [
                        { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                    ]
                }
            ],
            limit: parseInt(limit),
            offset,
            order: [['createdAt', 'DESC']],
        });

        // Enrich with unit names
        const unitIds = [...new Set(
            rows.flatMap(row => [row.primaryUnitId, row.secondaryUnitId]).filter(Boolean)
        )];

        const unitRows = unitIds.length
            ? await Volume.findAll({ where: { id: { [Op.in]: unitIds } }, attributes: ['id', 'name'] })
            : [];

        const getUnitLabel = (v) => {
            if (!v?.name || typeof v.name !== 'object') return 'Unit';
            return v.name.gu || v.name.en || Object.values(v.name)[0] || 'Unit';
        };
        const unitMap = new Map(unitRows.map(u => [u.id, getUnitLabel(u)]));

        const enriched = rows.map(row => ({
            ...row.toJSON(),
            primaryUnitName: unitMap.get(row.primaryUnitId) || 'Unit',
            secondaryUnitName: unitMap.get(row.secondaryUnitId) || 'Unit',
        }));

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Inventory logs fetched', {
            data: enriched,
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / parseInt(limit)),
            totalRecords: count,
        });
    } catch (error) {
        next(error);
    }
};
