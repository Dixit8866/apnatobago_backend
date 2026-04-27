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
        const onlyDigits = String(val ?? '').replace(/\D/g, '');
        const num = Number(onlyDigits);
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
    console.log('[Product API] createProduct CALLED');
    const t = await sequelize.transaction();
    try {
        console.log('[Product API Create] Payload variants:', JSON.stringify(req.body.variants, null, 2));

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

        const product = await Product.create(
            {
                name,
                thumbnail: String(thumbnail).trim(),
                images: normalizedImages,
                mainCategoryId,
                subCategoryId,
                companyCategoryId,
                isTobaccoProduct: isTobaccoProduct !== undefined ? isTobaccoProduct : true,
                productDescription: normalizeProductDescription(productDescription),
                status: status || 'Active',
            },
            { transaction: t }
        );

        for (const v of variants) {
            const volumeValue = String(v.volumeValue || '').trim();
            const volumeId = String(v.volumeId || '').trim();
            const purchasePrice = Number(v.purchasePrice);
            const image = typeof v.image === 'string' ? v.image.trim() : null;
            const baseUnitLabel = v.baseUnitLabel || null;
            const innerUnitLabel = v.innerUnitLabel || null;
            const baseUnitsPerPack = Number(v.baseUnitsPerPack || 1);
            const sellingVolume = v.sellingVolume ? Number(v.sellingVolume) : null;
            if (!volumeValue || !volumeId) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'volumeValue and volumeId are required for each variant.');
            }
            if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Valid purchasePrice is required for each volume.');
            }

            const volumeUnit = volumeMap.get(volumeId) || '';
            let normalizedVolume = `${volumeValue} ${volumeUnit}`.trim();
            
            // If the user already typed the unit in the value (e.g. "300ml"), don't double it
            if (volumeUnit && volumeValue.toLowerCase().endsWith(volumeUnit.toLowerCase())) {
                normalizedVolume = volumeValue.trim();
            }

            const variant = await ProductVariant.create(
                {
                    productId: product.id,
                    volumeId,
                    volume: normalizedVolume,
                    purchasePrice,
                    image,
                    baseUnitLabel,
                    innerUnitLabel,
                    baseUnitsPerPack,
                    sellingVolume,
                    status: v.status || 'Active',
                },
                { transaction: t }
            );

            const pricings = normalizeVariantPricings(v);
            for (const p of pricings) {
                if (!p.customLevelId || !p.quantityRange || p.minQty == null || p.maxQty == null) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'customLevelId and valid quantity range are required for pricing.');
                }
                if (p.price === undefined || p.mrp === undefined) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'price and mrp are required for pricing.');
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
        return sendSuccessResponse(res, HTTP_STATUS.CREATED, 'Product created successfully.', product);
    } catch (error) {
        await t.rollback();
        console.error('[Product API Create] ERROR:', error);
        next(error);
    }
};

export const getProducts = async (req, res, next) => {
    try {
        const { search = '', status, mainCategoryId } = req.query;
        
        const searchWhere = search
            ? { name: { [Op.cast]: 'text', [Op.iLike]: `%${search}%` } }
            : {};

        const whereWithFilters = { ...searchWhere };
        if (status) {
            whereWithFilters.status = status;
        } else {
            whereWithFilters.status = { [Op.ne]: 'Deleted' };
        }

        if (mainCategoryId) {
            whereWithFilters.mainCategoryId = mainCategoryId;
        }

        const pagination = getPaginationOptions(req.query);
        const { limit, offset, page } = pagination;

        const [activeCount, inactiveCount, deletedCount, totalCount] = await Promise.all([
            Product.count({ where: { ...searchWhere, status: 'Active', ...(mainCategoryId ? { mainCategoryId } : {}) } }),
            Product.count({ where: { ...searchWhere, status: 'Inactive', ...(mainCategoryId ? { mainCategoryId } : {}) } }),
            Product.count({ where: { ...searchWhere, status: 'Deleted', ...(mainCategoryId ? { mainCategoryId } : {}) } }),
            Product.count({ where: { ...searchWhere, ...(mainCategoryId ? { mainCategoryId } : {}) } }),
        ]);
        const statusCounts = { '': totalCount, Active: activeCount, Inactive: inactiveCount, Deleted: deletedCount };

        const include = [
            { model: MainCategory, as: 'mainCategory', attributes: ['id', 'title'] },
            { model: SubCategory, as: 'subCategory', attributes: ['id', 'title'] },
            { model: CompanyCategory, as: 'companyCategory', attributes: ['id', 'title'] },
            {
                model: ProductVariant,
                as: 'variants',
                required: false,
                include: [
                    {
                        model: ProductPricing,
                        as: 'pricings',
                        required: false,
                        include: [
                            { model: CustomLevel, as: 'customLevel', attributes: ['id', 'name'] }
                        ]
                    },
                    { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
                    { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
                ]
            }
        ];

        if (req.query.paginate === 'false') {
            const products = await Product.findAll({ where: whereWithFilters, include, order: [['position', 'ASC'], ['createdAt', 'DESC']] });
            return sendSuccessResponse(res, HTTP_STATUS.OK, 'Products fetched successfully.', { products, statusCounts });
        }

        const result = await Product.findAndCountAll({
            where: whereWithFilters,
            include,
            limit,
            offset,
            order: [['position', 'ASC'], ['createdAt', 'DESC']],
            distinct: true // Required when including hasMany associations with pagination
        });

        const responseData = formatPaginatedResponse(result, page, limit);
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
                {
                    model: ProductVariant,
                    as: 'variants',
                    include: [
                        {
                            model: ProductPricing,
                            as: 'pricings',
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
        });

        if (!product) return sendErrorResponse(res, HTTP_STATUS.NOT_FOUND, 'Product not found.');
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product fetched successfully.', product);
    } catch (error) {
        next(error);
    }
};

export const updateProduct = async (req, res, next) => {
    console.log('[Product API] updateProduct CALLED for ID:', req.params.id);
    const t = await sequelize.transaction();
    try {
        console.log('[Product API Update] Payload variants:', JSON.stringify(req.body.variants, null, 2));

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

        await product.update(
            {
                name,
                thumbnail: String(thumbnail).trim(),
                images: normalizedImages,
                mainCategoryId,
                subCategoryId,
                companyCategoryId,
                isTobaccoProduct: isTobaccoProduct !== undefined ? isTobaccoProduct : product.isTobaccoProduct,
                productDescription: normalizeProductDescription(productDescription),
                status: status || product.status,
            },
            { transaction: t }
        );

        // Soft-delete existing variants and pricings then recreate
        const existingVariants = await ProductVariant.findAll({ where: { productId: product.id }, transaction: t });
        const existingVariantIds = existingVariants.map((v) => v.id);
        if (existingVariantIds.length) {
            await ProductPricing.destroy({ where: { variantId: { [Op.in]: existingVariantIds } }, transaction: t });
            await ProductVariant.destroy({ where: { id: { [Op.in]: existingVariantIds } }, transaction: t });
        }

        for (const v of variants) {
            const volumeValue = String(v.volumeValue || '').trim();
            const volumeId = String(v.volumeId || '').trim();
            const purchasePrice = Number(v.purchasePrice);
            const image = typeof v.image === 'string' ? v.image.trim() : null;
            const baseUnitLabel = v.baseUnitLabel || null;
            const innerUnitLabel = v.innerUnitLabel || null;
            const baseUnitsPerPack = Number(v.baseUnitsPerPack || 1);
            const sellingVolume = v.sellingVolume ? Number(v.sellingVolume) : null;
            if (!volumeValue || !volumeId) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'volumeValue and volumeId are required for each variant.');
            }
            if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
                await t.rollback();
                return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Valid purchasePrice is required for each volume.');
            }

            const volumeUnit = volumeMap.get(volumeId) || '';
            let normalizedVolume = `${volumeValue} ${volumeUnit}`.trim();
            
            // If the user already typed the unit in the value (e.g. "300ml"), don't double it
            if (volumeUnit && volumeValue.toLowerCase().endsWith(volumeUnit.toLowerCase())) {
                normalizedVolume = volumeValue.trim();
            }

            const variant = await ProductVariant.create(
                {
                    productId: product.id,
                    volumeId,
                    volume: normalizedVolume,
                    purchasePrice,
                    image,
                    baseUnitLabel,
                    innerUnitLabel,
                    baseUnitsPerPack,
                    sellingVolume,
                    status: v.status || 'Active',
                },
                { transaction: t }
            );

            const pricings = normalizeVariantPricings(v);
            for (const p of pricings) {
                if (!p.customLevelId || !p.quantityRange || p.minQty == null || p.maxQty == null) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'customLevelId and valid quantity range are required for pricing.');
                }
                if (p.price === undefined || p.mrp === undefined) {
                    await t.rollback();
                    return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'price and mrp are required for pricing.');
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

        product.status = 'Deleted';
        await product.save();

        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Product deleted successfully.');
    } catch (error) {
        next(error);
    }
};

// ─── REORDER (DRAG & DROP) ───────────────────────────────────────────────────
export const reorderProducts = async (req, res, next) => {
    try {
        const { items } = req.body; // [{ id, position }]
        if (!Array.isArray(items)) {
            return sendErrorResponse(res, HTTP_STATUS.BAD_REQUEST, 'Invalid items array.');
        }

        // Update positions in parallel
        await Promise.all(
            items.map(async (item) => {
                if (!item.id || typeof item.position !== 'number') return;
                await Product.update(
                    { position: item.position },
                    { where: { id: item.id } }
                );
            })
        );

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
        const { productId, purchasePrice, pricings } = req.body;

        // Update first variant's purchasePrice
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
                // Update all pricing ranges for this level for simple inline editing
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

        await t.commit();
        return sendSuccessResponse(res, HTTP_STATUS.OK, 'Prices updated successfully.');
    } catch (error) {
        await t.rollback();
        console.error('[Product API UpdatePrices] ERROR:', error);
        next(error);
    }
};


