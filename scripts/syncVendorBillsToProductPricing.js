import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import { PurchaseBill, ProductVariant, ProductPricing, Godown, Product, VendorOrder } from '../models/index.js';

/**
 * Script to sync Purchase Bill pricing (Purchase Price, MRP, and Level-wise Selling Prices)
 * directly into Product Catalog (ProductVariant & ProductPricing) for all volume variants.
 * 
 * Usage:
 *   node scripts/syncVendorBillsToProductPricing.js              -> Syncs ALL purchase bills in order (chronological)
 *   node scripts/syncVendorBillsToProductPricing.js <BILL_NO>    -> Syncs a specific Purchase Bill by Bill No or UUID
 */

function extractPricingsFromItem(item) {
    if (item.pricings && Array.isArray(item.pricings) && item.pricings.length > 0) {
        return item.pricings.map(p => ({
            customLevelId: p.customLevelId,
            minQty: Number(p.minQty || 1),
            maxQty: Number(p.maxQty || 999),
            price: Number(p.price || 0),
            mrp: Number(p.mrp || p.price || 0),
            purchasePrice: Number(p.purchasePrice || item.purchasePrice || 0)
        }));
    }

    if (item.pricingLevels && Array.isArray(item.pricingLevels) && item.pricingLevels.length > 0) {
        const list = [];
        item.pricingLevels.forEach(lvl => {
            (lvl.rows || []).forEach(row => {
                if (row.minQty && row.maxQty && row.price) {
                    list.push({
                        customLevelId: lvl.customLevelId,
                        minQty: Number(row.minQty),
                        maxQty: Number(row.maxQty),
                        price: Number(row.price),
                        mrp: Number(row.mrp || row.price),
                        purchasePrice: Number(item.purchasePrice || 0)
                    });
                }
            });
        });
        return list;
    }

    return [];
}

async function syncVendorBillsToProductPricing() {
    const targetBillArg = process.argv[2]?.trim();

    try {
        await sequelize.authenticate();
        console.log('\n================================================================');
        console.log('📦 SYNC VENDOR PURCHASE BILLS TO LIVE PRODUCT CATALOG PRICING');
        console.log('================================================================\n');

        let whereClause = {};
        if (targetBillArg) {
            whereClause = {
                [Op.or]: [
                    { id: targetBillArg },
                    { billNo: targetBillArg }
                ]
            };
            console.log(`🔎 Filtering for specific Purchase Bill: "${targetBillArg}"...`);
        } else {
            console.log('🔄 Syncing ALL Purchase Bills in chronological order (oldest to newest)...');
        }

        const bills = await PurchaseBill.findAll({
            where: whereClause,
            order: [['createdAt', 'ASC']],
            include: [
                { model: Godown, as: 'godown', attributes: ['id', 'name'] }
            ]
        });

        if (bills.length === 0) {
            console.log('\n❌ No matching Purchase Bills found in database.');
            process.exit(0);
        }

        console.log(`\n📋 Found ${bills.length} Purchase Bill(s) to process.\n`);

        let totalBillsProcessed = 0;
        let totalVariantsUpdated = 0;
        let totalPricingRowsCreated = 0;

        for (const bill of bills) {
            const godownName = typeof bill.godown?.name === 'object'
                ? (bill.godown?.name?.en || Object.values(bill.godown?.name)[0])
                : (bill.godown?.name || 'Godown');

            console.log(`----------------------------------------------------------------`);
            console.log(`📄 Processing Bill No: ${bill.billNo} (Godown: "${godownName}")`);
            console.log(`----------------------------------------------------------------`);

            const items = Array.isArray(bill.items) ? bill.items : [];
            if (items.length === 0) {
                console.log(`   ⚠️ Bill ${bill.billNo} has no items. Skipping...`);
                continue;
            }

            const t = await sequelize.transaction();
            let billVariantsCount = 0;

            try {
                for (const item of items) {
                    // Extract list of variant objects (either inside variantsData or single item)
                    const variantsToProcess = [];

                    if (item.variantsData && Array.isArray(item.variantsData) && item.variantsData.length > 0) {
                        item.variantsData.forEach(vData => {
                            variantsToProcess.push({
                                variantId: vData.variantId,
                                purchasePrice: vData.purchasePrice || item.purchasePrice,
                                mrp: vData.mrp || item.mrp,
                                pricings: extractPricingsFromItem(vData)
                            });
                        });
                    } else if (item.variantId) {
                        variantsToProcess.push({
                            variantId: item.variantId,
                            purchasePrice: item.purchasePrice,
                            mrp: item.mrp,
                            pricings: extractPricingsFromItem(item)
                        });
                    }

                    for (const vObj of variantsToProcess) {
                        if (!vObj.variantId) continue;

                        const variant = await ProductVariant.findByPk(vObj.variantId, {
                            include: [{ model: Product, as: 'product' }],
                            transaction: t
                        });

                        if (!variant) {
                            console.log(`   ⚠️ Variant ID ${vObj.variantId} not found in ProductVariant table. Skipping...`);
                            continue;
                        }

                        const productName = typeof variant.product?.name === 'object'
                            ? (variant.product?.name?.en || Object.values(variant.product?.name)[0])
                            : (variant.product?.name || 'Product');

                        const purchasePrice = Number(vObj.purchasePrice || 0);

                        // 1. Update ProductVariant purchase price and MRP
                        const updatePayload = { purchasePrice };
                        if (vObj.mrp && Number(vObj.mrp) > 0) {
                            updatePayload.mrp = Number(vObj.mrp);
                        } else if (vObj.pricings.length > 0 && vObj.pricings[0].mrp > 0) {
                            updatePayload.mrp = Number(vObj.pricings[0].mrp);
                        }

                        await ProductVariant.update(updatePayload, {
                            where: { id: vObj.variantId },
                            transaction: t
                        });

                        console.log(`   ✅ Updated Product "${productName}" (Volume: ${variant.volume}) -> Purchase Price: ₹${purchasePrice}`);

                        // 2. Update default global ProductPricing (godownId = null)
                        if (vObj.pricings && vObj.pricings.length > 0) {
                            await ProductPricing.destroy({
                                where: { variantId: vObj.variantId, godownId: null },
                                transaction: t
                            });

                            for (const p of vObj.pricings) {
                                await ProductPricing.create({
                                    variantId: vObj.variantId,
                                    godownId: null,
                                    customLevelId: p.customLevelId,
                                    quantityRange: `${p.minQty}-${p.maxQty}`,
                                    minQty: p.minQty,
                                    maxQty: p.maxQty,
                                    purchasePrice: purchasePrice,
                                    price: p.price,
                                    mrp: p.mrp || p.price,
                                    status: 'Active'
                                }, { transaction: t });

                                totalPricingRowsCreated++;
                            }

                            // 3. Update godown-specific ProductPricing (godownId = bill.godownId)
                            if (bill.godownId) {
                                await ProductPricing.destroy({
                                    where: { variantId: vObj.variantId, godownId: bill.godownId },
                                    transaction: t
                                });

                                for (const p of vObj.pricings) {
                                    await ProductPricing.create({
                                        variantId: vObj.variantId,
                                        godownId: bill.godownId,
                                        customLevelId: p.customLevelId,
                                        quantityRange: `${p.minQty}-${p.maxQty}`,
                                        minQty: p.minQty,
                                        maxQty: p.maxQty,
                                        purchasePrice: purchasePrice,
                                        price: p.price,
                                        mrp: p.mrp || p.price,
                                        status: 'Active'
                                    }, { transaction: t });

                                    totalPricingRowsCreated++;
                                }
                            }

                            console.log(`      📊 Synced ${vObj.pricings.length} level pricing rows for both global & godown "${godownName}"`);
                        }

                        billVariantsCount++;
                        totalVariantsUpdated++;
                    }
                }

                await t.commit();
                totalBillsProcessed++;
                console.log(`   ✨ Successfully committed changes for Bill No: ${bill.billNo}\n`);
            } catch (billError) {
                await t.rollback();
                console.error(`   ❌ Error processing Bill No: ${bill.billNo}. Transaction rolled back.`, billError.message);
            }
        }

        console.log('================================================================');
        console.log('🎉 SYNC COMPLETE SUMMARY STATISTICS');
        console.log('================================================================');
        console.log(` Total Purchase Bills Processed : ${totalBillsProcessed}`);
        console.log(` Total Product Variants Updated : ${totalVariantsUpdated}`);
        console.log(` Total Level Pricing Rows Created: ${totalPricingRowsCreated}`);
        console.log('================================================================\n');

    } catch (error) {
        console.error('\n❌ Fatal error running sync script:', error);
    } finally {
        process.exit(0);
    }
}

syncVendorBillsToProductPricing();
