import { Op } from 'sequelize';
import sequelize from '../../config/db.js';
import HTTP_STATUS from '../../constants/httpStatusCodes.js';
import { getPaginationOptions, formatPaginatedResponse } from '../../helpers/query.helper.js';
import { sendErrorResponse, sendSuccessResponse } from '../../utils/response.util.js';
import Product from '../../models/superadmin-models/Product.js';
import ProductVariant from '../../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../../models/superadmin-models/ProductPricing.js';
import CustomLevel from '../../models/superadmin-models/CustomLevel.js';
import MainCategory from '../../models/superadmin-models/MainCategory.js';
import SubCategory from '../../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../../models/superadmin-models/CompanyCategory.js';
import Volume from '../../models/superadmin-models/Volume.js';
import InventoryStock from '../../models/superadmin-models/InventoryStock.js';
import { logActivity } from '../../helpers/activityLog.helper.js';

function hasAnyLangValue(obj) {
    return !!(obj && typeof obj === 'object' && Object.values(obj).some((v) => String(v || '').trim()));
}

function normalizeImages(arr) {
    const imgs = Array.isArray(arr) ? arr.filter(Boolean) : [];
    return imgs.map((x) => String(x).trim()).filter(Boolean);
}

function normalizeDescriptionSection(items) {
    if (!Array.isArray(items)) return [];
    return items.map((it) => ({
        key: String(it?.key || '').trim(),
        value: it?.value === undefined || it?.value === null ? null : String(it.value).trim() || null,
    }));
}

function normalizeProductDescription(desc) {
    const source = desc && typeof desc === 'object' ? desc : {};
    return {
        keyInformation: normalizeDescriptionSection(source.keyInformation),
        nutritionalInformation: normalizeDescriptionSection(source.nutritionalInformation),
        info: normalizeDescriptionSection(source.info),
    };
}

function getLocalizedText(multilingualField) {
    if (!multilingualField || typeof multilingualField !== 'object') return '';
    return Object.values(multilingualField).find((v) => String(v || '').trim()) || '';
}

function parseQuantityBounds(p) {
    const sanitize = (val) => {
        if (val === null || val === undefined || val === '') return null;
        const num = Number(val);
        return Number.isFinite(num) && num > 0 ? num : null;
    };

    let from = sanitize(p.quantityFrom ?? p.minQty);
    let to = sanitize(p.quantityTo ?? p.maxQty);

    if ((from == null || to == null) && p.quantityRange) {
        const match = String(p.quantityRange)
            .split('-')
            .map((part) => sanitize(part));
        if (match.length >= 2) {
            from = from ?? match[0];
            to = to ?? match[1];
        }
    }

    if (from == null || to == null) return { minQty: null, maxQty: null, quantityRange: '' };
    if (from > to) {
        const tmp = from;
        from = to;
        to = tmp;
    }

    return {
        minQty: from,
        maxQty: to,
        quantityRange: `${from}-${to}`,
    };
}

async function validateCategoryIds({ mainCategoryId, subCategoryId, companyCategoryId, transaction }) {
    if (!mainCategoryId || !subCategoryId || !companyCategoryId) {
        return 'mainCategoryId, subCategoryId and companyCategoryId are required.';
    }

    const [mainCategory, subCategory, companyCategory] = await Promise.all([
        MainCategory.findOne({ where: { id: mainCategoryId, status: 'Active' }, transaction }),
        SubCategory.findOne({ where: { id: subCategoryId, status: 'Active' }, transaction }),
        CompanyCategory.findOne({ where: { id: companyCategoryId, status: 'Active' }, transaction }),
    ]);

    if (!mainCategory || !subCategory || !companyCategory) {
        return 'Selected category is invalid or inactive.';
    }
    if (subCategory.mainCategoryId !== mainCategoryId) {
        return 'Selected sub category does not belong to selected main category.';
    }
    return null;
}

async function buildVolumeMap(variants, transaction) {
    const volumeIds = [...new Set(variants.map((v) => String(v.volumeId || '').trim()).filter(Boolean))];
    const volumeRows = await Volume.findAll({ where: { id: { [Op.in]: volumeIds }, status: 'Active' }, transaction });
    if (volumeRows.length !== volumeIds.length) {
        return { error: 'Invalid volume selected in variants.' };
    }

    return {
        volumeMap: new Map(volumeRows.map((row) => [row.id, getLocalizedText(row.name)])),
    };
}

function normalizeVariantPricings(variant) {
    if (Array.isArray(variant?.levelGroups) && variant.levelGroups.length) {
        return variant.levelGroups.flatMap((group) => {
            const groupLevelId = String(group?.customLevelId || '').trim();
            const rows = Array.isArray(group?.pricings) ? group.pricings : [];
            return rows.map((p) => ({
                customLevelId: String(p?.customLevelId || groupLevelId).trim(),
                ...parseQuantityBounds(p),
                price: p?.price,
                mrp: p?.mrp,
                status: p?.status || 'Active',
            }));
        });
    }

    const pricings = Array.isArray(variant?.pricings) ? variant.pricings : [];
    return pricings.map((p) => ({
        customLevelId: String(p?.customLevelId || '').trim(),
        ...parseQuantityBounds(p),
        price: p?.price,
        mrp: p?.mrp,
        status: p?.status || 'Active',
    }));
}

export const createProduct = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const {
            name,
            thumbnail,
            images,
            status,
            variants,
            mainCategoryId,
            subCategoryId,
            companyCategoryId,
            productDescription,
            isTobaccoProduct,
            hasCoupon,
            isCombo,
            comboProduct1Id,
            comboProduct2Id,
            keywords,
            boxNumber,
            serialNumber,
            mainVolumeId,
            mainVolumeQty,
            customSalesVolumeId,
            customSalesVolumeQty,
            internalNote,
            couponPoints,
            couponPrice,
        } = req.body;

        if (!hasAnyLangValue(name)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please provide product name in at least one language.');
        }
        if (!thumbnail || !String(thumbnail).trim()) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Thumbnail image is required.');
        }

        const normalizedImages = normalizeImages(images);
        if (normalizedImages.length > 5) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Maximum 5 product images allowed.');
        }

        if (!Array.isArray(variants) || variants.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'At least one volume variant is required.');
        }

        if (isCombo) {
            if (!comboProduct1Id || !comboProduct2Id) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please select both combo products. (કૃપા કરીને બંને કોમ્બો પ્રોડક્ટ્સ પસંદ કરો.)');
            }
            if (comboProduct1Id === comboProduct2Id) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Both combo products cannot be the same. (કોમ્બોની બંને પ્રોડક્ટ સમાન ન હોઈ શકે.)');
            }
        }

        const categoryError = await validateCategoryIds({ mainCategoryId, subCategoryId, companyCategoryId, transaction: t });
        if (categoryError) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, categoryError);
        }

        const { volumeMap, error: volumeError } = await buildVolumeMap(variants, t);
        if (volumeError) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, volumeError);
        }

        const maxPos = await Product.max('position', {
            where: { status: { [Op.ne]: 'Deleted' } },
            transaction: t
        }) || 0;

        const product = await Product.create(
            {
                name,
                thumbnail: String(thumbnail).trim(),
                images: normalizedImages,
                mainCategoryId,
                subCategoryId,
                companyCategoryId,
                isTobaccoProduct: isTobaccoProduct !== undefined ? isTobaccoProduct : true,
                hasCoupon: hasCoupon !== undefined ? hasCoupon : false,
                productDescription: normalizeProductDescription(productDescription),
                status: status || 'Active',
                isCombo: isCombo !== undefined ? isCombo : false,
                comboProduct1Id: comboProduct1Id || null,
                comboProduct2Id: comboProduct2Id || null,
                position: maxPos + 1,
                keywords: Array.isArray(keywords) ? keywords.map(k => String(k).trim()).filter(Boolean) : [],
                boxNumber: boxNumber || null,
                serialNumber: serialNumber || null,
                mainVolumeId: mainVolumeId || null,
                mainVolumeQty: mainVolumeQty ? Number(mainVolumeQty) : 1,
                customSalesVolumeId: customSalesVolumeId || null,
                customSalesVolumeQty: customSalesVolumeQty ? Number(customSalesVolumeQty) : 1,
                internalNote: internalNote || null,
                couponPoints: couponPoints !== undefined && couponPoints !== '' && couponPoints !== null ? Number(couponPoints) : null,
                couponPrice: couponPrice !== undefined && couponPrice !== '' && couponPrice !== null ? Number(couponPrice) : null,
            },
            { transaction: t }
        );

        for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            const extra = typeof v.extra === 'string' ? v.extra.trim() : null;
            const volumeValue = String(v.volumeValue || '').trim();
            const volumeId = String(v.volumeId || '').trim();
            const purchasePrice = Number(v.purchasePrice);
            const image = typeof v.image === 'string' ? v.image.trim() : null;
            const baseUnitLabel = v.baseUnitLabel || null;
            const innerUnitLabel = v.innerUnitLabel || null;
            const baseUnitsPerPack = Number(v.baseUnitsPerPack || 1);
            const sellingVolume = v.sellingVolume ? Number(v.sellingVolume) : null;
            const minQty = v.minQty ? Number(v.minQty) : null;
            const maxQty = v.maxQty ? Number(v.maxQty) : null;
            if (!volumeValue) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'volumeValue is required for each variant.');
            }
            if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Valid purchasePrice is required for each volume.');
            }

            const volumeUnit = volumeMap.get(volumeId) || '';
            // Store the user's raw input as-is in the volume column.
            // The volumeId column already references the unit — no need to append it.
            // Appending the unit caused edit-load issues ("1 packet cartton" parsed back as "1").
            const normalizedVolume = volumeValue.trim() || (volumeUnit ? `${volumeUnit}` : '');


            const variant = await ProductVariant.create(
                {
                    productId: product.id,
                    extra: extra || null,
                    volumeId: volumeId || null,
                    volume: normalizedVolume,
                    purchasePrice,
                    image,
                    baseUnitLabel,
                    innerUnitLabel,
                    baseUnitsPerPack,
                    sellingVolume,
                    minQty,
                    maxQty,
                    status: v.status || 'Active',
                    position: i,
                },
                { transaction: t }
            );

            const pricings = normalizeVariantPricings(v);
            for (const p of pricings) {
                if (!p.customLevelId || !p.quantityRange || p.minQty == null || p.maxQty == null) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'customLevelId and valid quantity range are required for pricing.');
                }
                const numMRP = Number(p.mrp);
                const numPrice = Number(p.price);

                if (p.mrp === undefined || p.mrp === null || String(p.mrp).trim() === '' || isNaN(numMRP) || numMRP <= 0) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please enter a valid MRP greater than 0 for all pricing entries. (એમઆરપી કિંમત 0 થી વધારે હોવી જોઈએ.)');
                }
                if (p.price === undefined || p.price === null || String(p.price).trim() === '' || isNaN(numPrice) || numPrice <= 0) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please enter a valid Selling Price greater than 0 for all pricing entries. (વેચાણ કિંમત 0 થી વધારે હોવી જોઈએ.)');
                }
                if (numPrice < purchasePrice) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be lower than purchase price (${purchasePrice}) for variant "${normalizedVolume}". (વેચાણ કિંમત ખરીદ કિંમત કરતા ઓછી ન હોવી જોઈએ.)`);
                }
                if (numPrice > numMRP) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be higher than MRP (${p.mrp}) for variant "${normalizedVolume}". (વેચાણ કિંમત એમઆરપી કરતા વધારે ન હોઈ શકે.)`);
                }

                await ProductPricing.create(
                    {
                        variantId: variant.id,
                        customLevelId: p.customLevelId,
                        quantityRange: p.quantityRange,
                        minQty: p.minQty,
                        maxQty: p.maxQty,
                        purchasePrice,
                        price: p.price,
                        mrp: p.mrp,
                        status: p.status || 'Active',
                    },
                    { transaction: t }
                );
            }
        }

        await t.commit();

        logActivity(req, {
            module: 'Products',
            action: 'CREATE',
            description: `Created Product "${getLocalizedText(product.name)}"`,
            metadata: { productId: product.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Product created successfully.', product);
    } catch (error) {
        await t.rollback();
        console.error('[Product API Create] ERROR:', error);
        next(error);
    }
};

const sortVariants = (productJson) => {
    if (productJson && productJson.variants && productJson.variants.length) {
        productJson.variants.sort((a, b) => {
            const posA = a.position !== undefined && a.position !== null ? Number(a.position) : 0;
            const posB = b.position !== undefined && b.position !== null ? Number(b.position) : 0;
            if (posA !== posB) return posA - posB;
            const dateA = new Date(a.createdAt || 0);
            const dateB = new Date(b.createdAt || 0);
            return dateA - dateB;
        });
    }
    return productJson;
};

export const getProducts = async (req, res, next) => {
    try {
        const { search = '', status, mainCategoryId, subCategoryId, isTobacco, godownId } = req.query;
        const isInventoryView = req.query.inventoryView === 'true';

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
                        { serialNumber: { [Op.iLike]: `%${term}%` } },
                        { boxNumber: { [Op.iLike]: `%${term}%` } },
                        sequelize.literal(`EXISTS (SELECT 1 FROM unnest("Product"."keywords") AS k WHERE k ILIKE ${sequelize.escape('%' + term + '%')})`)
                    ]
                }))
            }
            : {};

        if (isTobacco !== undefined && isTobacco !== '') {
            searchWhere.isTobaccoProduct = isTobacco === 'true';
        }

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

        if (isInventoryView) {
            whereWithFilters.status = { [Op.ne]: 'Deleted' };
            if (status === 'Active') {
                // In Stock: at least one variant has total stock > 0
                whereWithFilters[Op.and] = [
                    ...(searchWhere[Op.and] || []),
                    sequelize.literal(`${stockSubquery} > 0`)
                ];
            } else if (status === 'Inactive') {
                // Out of Stock: all variants have total stock = 0
                whereWithFilters[Op.and] = [
                    ...(searchWhere[Op.and] || []),
                    sequelize.literal(`${stockSubquery} = 0`)
                ];
            } else if (status === 'Deleted') {
                whereWithFilters.status = 'Deleted';
            }
        } else {
            if (status === 'Low Stock') {
                whereWithFilters.status = 'Active';
                whereWithFilters[Op.and] = [
                    ...(searchWhere[Op.and] || []),
                    sequelize.literal(`${stockSubquery} = 0`)
                ];
            } else if (status) {
                whereWithFilters.status = status;
            } else {
                whereWithFilters.status = { [Op.ne]: 'Deleted' };
            }
        }

        if (mainCategoryId) {
            whereWithFilters.mainCategoryId = mainCategoryId;
        }
        if (subCategoryId) {
            whereWithFilters.subCategoryId = subCategoryId;
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        let activeCount, inactiveCount, deletedCount, totalCount, lowStockCount = 0;

        const countBaseWhere = { ...searchWhere };
        if (mainCategoryId) {
            countBaseWhere.mainCategoryId = mainCategoryId;
        }
        if (subCategoryId) {
            countBaseWhere.subCategoryId = subCategoryId;
        }

        if (isInventoryView) {
            [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
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
                        status: 'Deleted'
                    }
                }),
                Product.count({
                    where: {
                        ...countBaseWhere,
                        status: { [Op.ne]: 'Deleted' }
                    }
                })
            ]);
        } else {
            const lowStockVal = await Product.count({
                where: {
                    ...countBaseWhere,
                    status: 'Active',
                    [Op.and]: [
                        ...(countBaseWhere[Op.and] || []),
                        sequelize.literal(`${stockSubquery} = 0`)
                    ]
                }
            });
            lowStockCount = lowStockVal;

            [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
                Product.count({ where: { ...searchWhere, status: 'Active', ...(mainCategoryId ? { mainCategoryId } : {}), ...(subCategoryId ? { subCategoryId } : {}) } }),
                Product.count({ where: { ...searchWhere, status: 'Inactive', ...(mainCategoryId ? { mainCategoryId } : {}), ...(subCategoryId ? { subCategoryId } : {}) } }),
                Product.count({ where: { ...searchWhere, status: 'Deleted', ...(mainCategoryId ? { mainCategoryId } : {}), ...(subCategoryId ? { subCategoryId } : {}) } }),
                Product.count({ where: { ...searchWhere, ...(mainCategoryId ? { mainCategoryId } : {}), ...(subCategoryId ? { subCategoryId } : {}) } }),
            ]);
        }
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount, 'Low Stock': lowStockCount };

        const include = [
            { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
            { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
            { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title'] },
            { model: Volume, as: 'mainVolume', attributes: ['id', 'name'] },
            { model: Volume, as: 'customSalesVolume', attributes: ['id', 'name'] },
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
                    {
                        model: ProductPricing,
                        as: 'pricings',
                        where: { godownId: null },
                        required: false,
                        include: [
                            { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] }
                        ]
                    },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] }
                ]
            }
        ];

        if (req.query.paginate === 'false') {
            const products = await Product.findAll({
                where: whereWithFilters,
                include,
                order: [
                    ['position', 'ASC'],
                    ['createdAt', 'DESC'],
                    [{ model: ProductVariant, as: 'variants' }, 'position', 'ASC'],
                    [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC']
                ]
            });
            const productsJson = products.map(p => sortVariants(p.toJSON()));
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Products fetched successfully.', { products: productsJson, statusCounts });
        }

        const result = await Product.findAndCountAll({
            where: whereWithFilters,
            include,
            limit,
            offset,
            order: [
                ['position', 'ASC'],
                ['createdAt', 'DESC'],
                [{ model: ProductVariant, as: 'variants' }, 'position', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC']
            ],
            distinct: true // Required when including hasMany associations with pagination
        });

        const responseData = formatPaginatedResponse(result, page, limit);
        if (responseData.items) {
            responseData.items = responseData.items.map(p => sortVariants(p.toJSON ? p.toJSON() : p));
        }
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Products fetched successfully.', {
            ...responseData,
            statusCounts,
        });
    } catch (error) {
        next(error);
    }
};

export const getProductById = async (req, res, next) => {
    try {
        const product = await Product.findByPk(req.params.id, {
            include: [
                { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title', 'status'] },
                { model: SubCategory, as: 'subCategory', attributes: ['id', 'mainCategoryId', 'title', 'status'] },
                { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title', 'status'] },
                { model: Volume, as: 'mainVolume', attributes: ['id', 'name', 'status'] },
                { model: Volume, as: 'customSalesVolume', attributes: ['id', 'name', 'status'] },
                { model: Product, as: 'comboProduct1', attributes: ['id', 'name', 'thumbnail'] },
                { model: Product, as: 'comboProduct2', attributes: ['id', 'name', 'thumbnail'] },
                {
                    model: ProductVariant,
                    as: 'variants',
                    include: [
                        {
                            model: ProductPricing,
                            as: 'pricings',
                            where: { godownId: null },
                            required: false,
                            include: [
                                { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name', 'status'] },
                            ],
                        },
                        { model: Volume, as: 'volumeRef', attributes: ['id', 'name', 'status'] },
                        { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name', 'status'] },
                        { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name', 'status'] },
                    ],
                },
            ],
            order: [
                [{ model: ProductVariant, as: 'variants' }, 'position', 'ASC'],
                [{ model: ProductVariant, as: 'variants' }, 'createdAt', 'ASC']
            ],
        });

        if (!product) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        const productJson = sortVariants(product.toJSON());
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product fetched successfully.', productJson);
    } catch (error) {
        next(error);
    }
};

export const updateProduct = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const {
            name,
            thumbnail,
            images,
            status,
            variants,
            mainCategoryId,
            subCategoryId,
            companyCategoryId,
            productDescription,
            isTobaccoProduct,
            hasCoupon,
            isCombo,
            comboProduct1Id,
            comboProduct2Id,
            keywords,
            boxNumber,
            serialNumber,
            mainVolumeId,
            mainVolumeQty,
            customSalesVolumeId,
            customSalesVolumeQty,
            internalNote,
            couponPoints,
            couponPrice,
        } = req.body;
        const product = await Product.findByPk(req.params.id, { transaction: t });

        if (!product) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        }

        if (!hasAnyLangValue(name)) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please provide product name in at least one language.');
        }
        if (!thumbnail || !String(thumbnail).trim()) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Thumbnail image is required.');
        }

        const normalizedImages = normalizeImages(images);
        if (normalizedImages.length > 5) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Maximum 5 product images allowed.');
        }
        if (!Array.isArray(variants) || variants.length === 0) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'At least one volume variant is required.');
        }

        if (isCombo) {
            if (!comboProduct1Id || !comboProduct2Id) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please select both combo products. (કૃપા કરીને બંને કોમ્બો પ્રોડક્ટ્સ પસંદ કરો.)');
            }
            if (comboProduct1Id === comboProduct2Id) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Both combo products cannot be the same. (કોમ્બોની બંને પ્રોડક્ટ સમાન ન હોઈ શકે.)');
            }
        }

        const categoryError = await validateCategoryIds({ mainCategoryId, subCategoryId, companyCategoryId, transaction: t });
        if (categoryError) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, categoryError);
        }

        const { volumeMap, error: volumeError } = await buildVolumeMap(variants, t);
        if (volumeError) {
            await t.rollback();
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, volumeError);
        }

        // Fetch existing variants of the product from database
        const existingVariants = await ProductVariant.findAll({ where: { productId: product.id }, transaction: t });

        // Retrieve any active stock records linked to variant IDs for this product
        const stocks = await InventoryStock.findAll({
            where: {
                productId: product.id,
                totalBaseUnits: { [Op.gt]: 0 },
                status: 'Active'
            },
            transaction: t
        });
        const activeStockVariantIds = new Set(stocks.map(s => s.variantId));

        // Validation 1: Check if any existing variant that has active stock is missing from the incoming variants payload (attempted deletion of a variant with stock)
        for (const ev of existingVariants) {
            if (activeStockVariantIds.has(ev.id)) {
                const stillExists = variants.some(v => {
                    if (v.id) {
                        return ev.id === v.id;
                    }
                    const volumeUnit = volumeMap.get(v.volumeId) || '';
                    const normalizedVolume = String(v.volumeValue || '').trim() || (volumeUnit ? `${volumeUnit}` : '');
                    const extra = typeof v.extra === 'string' ? v.extra.trim() : '';
                    return ev.volumeId === (v.volumeId || null) && ev.volume === normalizedVolume && (ev.extra || '').trim() === extra;
                });
                if (!stillExists) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Cannot update product/volume because stock is already added. (તમે જે વોલ્યુમ અથવા પ્રોડક્ટ અપડેટ કરો છો તેમાં ઓલરેડી સ્ટોક એડ કરેલો છે.)');
                }
            }
        }

        // Validation 2: Check if the user is trying to change Volume, Packing Unit (Outer), or Item Unit (Inner) for any variant with active stock
        for (const v of variants) {
            const volumeUnit = volumeMap.get(v.volumeId) || '';
            const normalizedVolume = String(v.volumeValue || '').trim() || (volumeUnit ? `${volumeUnit}` : '');
            const baseUnitLabel = v.baseUnitLabel || null;
            const innerUnitLabel = v.innerUnitLabel || null;
            const extra = typeof v.extra === 'string' ? v.extra.trim() : '';

            const matchedExisting = existingVariants.find(ev => {
                if (v.id) {
                    return ev.id === v.id;
                }
                return ev.volumeId === (v.volumeId || null) && ev.volume === normalizedVolume && (ev.extra || '').trim() === extra;
            });

            if (matchedExisting && activeStockVariantIds.has(matchedExisting.id)) {
                // Check if critical fields differ
                if (
                    matchedExisting.volume !== normalizedVolume ||
                    matchedExisting.volumeId !== (v.volumeId || null) ||
                    matchedExisting.baseUnitLabel !== baseUnitLabel ||
                    matchedExisting.innerUnitLabel !== innerUnitLabel
                ) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Cannot update product/volume because stock is already added. (તમે જે વોલ્યુમ અથવા પ્રોડક્ટ અપડેટ કરો છો તેમાં ઓલરેડી સ્ટોક એડ કરેલો છે.)');
                }
            }
        }

        await product.update(
            {
                name,
                thumbnail: String(thumbnail).trim(),
                images: normalizedImages,
                mainCategoryId,
                subCategoryId,
                companyCategoryId,
                isTobaccoProduct: isTobaccoProduct !== undefined ? isTobaccoProduct : product.isTobaccoProduct,
                hasCoupon: hasCoupon !== undefined ? hasCoupon : product.hasCoupon,
                productDescription: normalizeProductDescription(productDescription),
                status: status || product.status,
                isCombo: isCombo !== undefined ? isCombo : product.isCombo,
                comboProduct1Id: comboProduct1Id !== undefined ? comboProduct1Id : product.comboProduct1Id,
                comboProduct2Id: comboProduct2Id !== undefined ? comboProduct2Id : product.comboProduct2Id,
                keywords: Array.isArray(keywords) ? keywords.map(k => String(k).trim()).filter(Boolean) : (product.keywords || []),
                boxNumber: boxNumber !== undefined ? boxNumber : product.boxNumber,
                serialNumber: serialNumber !== undefined ? serialNumber : product.serialNumber,
                mainVolumeId: mainVolumeId !== undefined ? (mainVolumeId || null) : product.mainVolumeId,
                mainVolumeQty: mainVolumeQty !== undefined ? (mainVolumeQty ? Number(mainVolumeQty) : 1) : product.mainVolumeQty,
                customSalesVolumeId: customSalesVolumeId !== undefined ? (customSalesVolumeId || null) : product.customSalesVolumeId,
                customSalesVolumeQty: customSalesVolumeQty !== undefined ? (customSalesVolumeQty ? Number(customSalesVolumeQty) : 1) : product.customSalesVolumeQty,
                internalNote: internalNote !== undefined ? (internalNote || null) : product.internalNote,
                couponPoints: couponPoints !== undefined ? (couponPoints !== '' && couponPoints !== null ? Number(couponPoints) : null) : product.couponPoints,
                couponPrice: couponPrice !== undefined ? (couponPrice !== '' && couponPrice !== null ? Number(couponPrice) : null) : product.couponPrice,
            },
            { transaction: t }
        );

        // Track the IDs of existing variants that were updated
        const matchedExistingIds = new Set();

        for (let i = 0; i < variants.length; i++) {
            const v = variants[i];
            const extra = typeof v.extra === 'string' ? v.extra.trim() : null;
            const volumeValue = String(v.volumeValue || '').trim();
            const volumeId = String(v.volumeId || '').trim();
            const purchasePrice = Number(v.purchasePrice);
            const image = typeof v.image === 'string' ? v.image.trim() : null;
            const baseUnitLabel = v.baseUnitLabel || null;
            const innerUnitLabel = v.innerUnitLabel || null;
            const baseUnitsPerPack = Number(v.baseUnitsPerPack || 1);
            const sellingVolume = v.sellingVolume ? Number(v.sellingVolume) : null;
            const minQty = v.minQty ? Number(v.minQty) : null;
            const maxQty = v.maxQty ? Number(v.maxQty) : null;
            if (!volumeValue) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'volumeValue is required for each variant.');
            }
            if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Valid purchasePrice is required for each volume.');
            }

            const volumeUnit = volumeMap.get(volumeId) || '';
            // Store the user's raw input as-is in the volume column.
            // The volumeId column already references the unit — no need to append it.
            // Appending the unit caused edit-load issues ("1 packet cartton" parsed back as "1").
            const normalizedVolume = volumeValue.trim() || (volumeUnit ? `${volumeUnit}` : '');

            // Try to find the matching existing variant
            const matchedExisting = existingVariants.find(ev => {
                if (v.id) {
                    return ev.id === v.id;
                }
                return ev.volumeId === (volumeId || null) && ev.volume === normalizedVolume && (ev.extra || '').trim() === (extra || '').trim();
            });

            let variantInstance;
            if (matchedExisting) {
                // Update existing variant in-place
                await matchedExisting.update(
                    {
                        extra: extra || null,
                        volumeId: volumeId || null,
                        volume: normalizedVolume,
                        purchasePrice,
                        image,
                        baseUnitLabel,
                        innerUnitLabel,
                        baseUnitsPerPack,
                        sellingVolume,
                        minQty,
                        maxQty,
                        status: v.status || 'Active',
                        position: i,
                    },
                    { transaction: t }
                );
                variantInstance = matchedExisting;
                matchedExistingIds.add(matchedExisting.id);
            } else {
                // Create a new variant
                variantInstance = await ProductVariant.create(
                    {
                        productId: product.id,
                        extra: extra || null,
                        volumeId: volumeId || null,
                        volume: normalizedVolume,
                        purchasePrice,
                        image,
                        baseUnitLabel,
                        innerUnitLabel,
                        baseUnitsPerPack,
                        sellingVolume,
                        minQty,
                        maxQty,
                        status: v.status || 'Active',
                        position: i,
                    },
                    { transaction: t }
                );
            }

            // Always destroy previous pricings for this specific variant (if it was updated) and recreate them
            await ProductPricing.destroy({ where: { variantId: variantInstance.id }, transaction: t });

            const pricings = normalizeVariantPricings(v);
            for (const p of pricings) {
                if (!p.customLevelId || !p.quantityRange || p.minQty == null || p.maxQty == null) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'customLevelId and valid quantity range are required for pricing.');
                }
                const numMRP = Number(p.mrp);
                const numPrice = Number(p.price);

                if (p.mrp === undefined || p.mrp === null || String(p.mrp).trim() === '' || isNaN(numMRP) || numMRP <= 0) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please enter a valid MRP greater than 0 for all pricing entries. (એમઆરપી કિંમત 0 થી વધારે હોવી જોઈએ.)');
                }
                if (p.price === undefined || p.price === null || String(p.price).trim() === '' || isNaN(numPrice) || numPrice <= 0) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Please enter a valid Selling Price greater than 0 for all pricing entries. (веચાણ કિંમત 0 થી વધારે હોવી જોઈએ.)');
                }
                if (numPrice < purchasePrice) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be lower than purchase price (${purchasePrice}) for variant "${normalizedVolume}". (વેચાણ કિંમત ખરીદ કિંમત કરતા ઓછી ન હોવી જોઈએ.)`);
                }
                if (numPrice > numMRP) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be higher than MRP (${p.mrp}) for variant "${normalizedVolume}". (વેચાણ કિંમત એમઆરપી કરતા વધારે ન હોઈ શકે.)`);
                }

                await ProductPricing.create(
                    {
                        variantId: variantInstance.id,
                        customLevelId: p.customLevelId,
                        quantityRange: p.quantityRange,
                        minQty: p.minQty,
                        maxQty: p.maxQty,
                        purchasePrice,
                        price: p.price,
                        mrp: p.mrp,
                        status: p.status || 'Active',
                    },
                    { transaction: t }
                );
            }
        }

        // Clean up: For all existing variants in database that were NOT matched by any incoming variant (i.e. deleted by the user in the UI)
        for (const ev of existingVariants) {
            if (!matchedExistingIds.has(ev.id)) {
                await ProductPricing.destroy({ where: { variantId: ev.id }, transaction: t });
                await ProductVariant.destroy({ where: { id: ev.id }, transaction: t });
            }
        }

        await t.commit();

        logActivity(req, {
            module: 'Products',
            action: 'UPDATE',
            description: `Updated Product "${getLocalizedText(product.name)}"`,
            metadata: { productId: product.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product updated successfully.', product);
    } catch (error) {
        await t.rollback();
        console.error('[Product API Update] ERROR:', error);
        next(error);
    }
};

export const deleteProduct = async (req, res, next) => {
    try {
        const product = await Product.findByPk(req.params.id);
        if (!product) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');

        // Check if there is active stock for any variant of this product in inventory_stocks
        const hasStock = await InventoryStock.findOne({
            where: {
                productId: product.id,
                totalBaseUnits: { [Op.gt]: 0 },
                status: 'Active'
            }
        });

        if (hasStock) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Cannot delete product because it has active stock. (ઉત્પાદન કાઢી શકાતું નથી કારણ કે તેમાં સક્રિય સ્ટોક છે.)');
        }

        product.status = 'Deleted';
        await product.save();

        logActivity(req, {
            module: 'Products',
            action: 'DELETE',
            description: `Deleted Product "${getLocalizedText(product.name)}"`,
            metadata: { productId: product.id }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product deleted successfully.');
    } catch (error) {
        next(error);
    }
};

// ─── REORDER (DRAG & DROP) ───────────────────────────────────────────────────
export const reorderProducts = async (req, res, next) => {
    try {
        const { items } = req.body; // [{ id, position }]
        if (!Array.isArray(items) || items.length === 0) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid items array.');
        }

        // Fetch all active products ordered by position ASC, createdAt DESC
        const allProducts = await Product.findAll({
            where: { status: { [Op.ne]: 'Deleted' } },
            order: [['position', 'ASC'], ['createdAt', 'DESC']]
        });

        // Map frontend items by id for quick lookup and get their new order
        const frontendOrderMap = new Map(items.map((item, index) => [item.id, index]));

        // Find the index in allProducts of the first item that is being reordered
        let firstReorderedIndex = allProducts.findIndex(p => frontendOrderMap.has(p.id));
        if (firstReorderedIndex === -1) {
            firstReorderedIndex = 0;
        }

        // Separate untouched and reordered products
        const untouchedBefore = [];
        const untouchedAfter = [];
        const reordered = [];

        allProducts.forEach((p, idx) => {
            if (frontendOrderMap.has(p.id)) {
                reordered.push(p);
            } else {
                if (idx < firstReorderedIndex) {
                    untouchedBefore.push(p);
                } else {
                    untouchedAfter.push(p);
                }
            }
        });

        // Sort the reordered products based on the frontend order
        reordered.sort((a, b) => frontendOrderMap.get(a.id) - frontendOrderMap.get(b.id));

        // Combine them: untouchedBefore + reordered + untouchedAfter
        const combined = [...untouchedBefore, ...reordered, ...untouchedAfter];

        // Update all positions in the DB sequentially in a transaction to ensure atomicity
        const transaction = await Product.sequelize.transaction();
        try {
            for (let i = 0; i < combined.length; i++) {
                await Product.update(
                    { position: i },
                    {
                        where: { id: combined[i].id },
                        transaction
                    }
                );
            }
            await transaction.commit();
        } catch (err) {
            await transaction.rollback();
            throw err;
        }

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Products reordered successfully.');
    } catch (error) {
        next(error);
    }
};

// ─── MOVE TO TOP ─────────────────────────────────────────────────────────────
export const moveProductToTop = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get all active products ordered by position
        const products = await Product.findAll({
            where: { status: { [Op.ne]: 'Deleted' } },
            order: [['position', 'ASC']]
        });

        // Find the target product
        const targetIndex = products.findIndex(p => p.id === id);
        if (targetIndex === -1) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        }

        // Remove target from current position and insert at beginning
        const [target] = products.splice(targetIndex, 1);
        products.unshift(target);

        // Update all positions sequentially
        await Promise.all(
            products.map(async (prod, index) => {
                await Product.update(
                    { position: index },
                    { where: { id: prod.id } }
                );
            })
        );

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product moved to top successfully.');
    } catch (error) {
        next(error);
    }
};

// ─── UPDATE PRICES (INLINE EDIT) ─────────────────────────────────────────────
export const updateProductPrices = async (req, res, next) => {
    const t = await sequelize.transaction();
    try {
        const { productId, purchasePrice, pricings, variants } = req.body;

        if (Array.isArray(variants)) {
            // Detailed update logic
            for (const v of variants) {
                const variant = await ProductVariant.findByPk(v.id, { transaction: t });
                if (!variant) continue;

                const currentPurchasePrice = v.purchasePrice !== undefined ? Number(v.purchasePrice) : Number(variant.purchasePrice || 0);

                if (v.purchasePrice !== undefined) {
                    await variant.update({ purchasePrice: v.purchasePrice }, { transaction: t });
                }

                if (Array.isArray(v.pricings)) {
                    for (const p of v.pricings) {
                        if (p.id) {
                            if (p.price !== undefined && Number(p.price) < currentPurchasePrice) {
                                await t.rollback();
                                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be lower than purchase price (${currentPurchasePrice}) for variant "${variant.volume}". (વેચાણ કિંમત ખરીદ કિંમત કરતા ઓછી ન હોવી જોઈએ.)`);
                            }
                            await ProductPricing.update(
                                { price: p.price, mrp: p.mrp, purchasePrice: currentPurchasePrice },
                                { where: { id: p.id }, transaction: t }
                            );
                        }
                    }
                }
            }
        } else {
            // Original flat payload logic
            const variant = await ProductVariant.findOne({
                where: { productId },
                order: [['createdAt', 'ASC']],
                transaction: t
            });

            if (!variant) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product variant not found.');
            }

            await variant.update({ purchasePrice }, { transaction: t });

            if (Array.isArray(pricings)) {
                for (const p of pricings) {
                    if (p.price !== undefined && Number(p.price) < Number(purchasePrice)) {
                        await t.rollback();
                        return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, `Selling price (${p.price}) cannot be lower than purchase price (${purchasePrice}) for variant "${variant.volume}". (વેચાણ કિંમત ખરીદ કિંમત કરતા ઓછી ન હોવી જોઈએ.)`);
                    }
                    await ProductPricing.update(
                        { price: p.price, mrp: p.mrp, purchasePrice },
                        {
                            where: {
                                variantId: variant.id,
                                customLevelId: p.customLevelId
                            },
                            transaction: t
                        }
                    );
                }
            }
        }

        await t.commit();

        logActivity(req, {
            module: 'Products',
            action: 'UPDATE',
            description: `Updated prices for Product ID #${productId || 'bulk'}`,
            metadata: { productId }
        });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Prices updated successfully.');
    } catch (error) {
        await t.rollback();
        console.error('[Product API UpdatePrices] ERROR:', error);
        next(error);
    }
};

export const updateProductBoxNumber = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { boxNumber } = req.body;

        const product = await Product.findByPk(id);
        if (!product) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        }

        await product.update({ boxNumber: boxNumber || null });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product Box Number updated successfully.', product);
    } catch (error) {
        next(error);
    }
};

export const updateProductSerialNumber = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { serialNumber } = req.body;

        const product = await Product.findByPk(id);
        if (!product) {
            return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        }

        await product.update({ serialNumber: serialNumber || null });

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product Serial Number updated successfully.', product);
    } catch (error) {
        next(error);
    }
};


