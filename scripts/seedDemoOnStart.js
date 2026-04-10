import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import Product from '../models/superadmin-models/Product.js';
import ProductVariant from '../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../models/superadmin-models/ProductPricing.js';
import CustomLevel from '../models/superadmin-models/CustomLevel.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../models/superadmin-models/CompanyCategory.js';
import Volume from '../models/superadmin-models/Volume.js';
import Godown from '../models/superadmin-models/Godown.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';
import InventoryTransaction from '../models/superadmin-models/InventoryTransaction.js';

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function baseUnitLabelToVolumeName(label) {
  const v = String(label || '').trim().toLowerCase();
  if (v === 'gram' || v === 'g') return 'gram';
  if (v === 'ml') return 'ml';
  return 'pcs';
}

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

function getSeedMode() {
  const mode = String(process.env.SEED_MODE || '').trim().toLowerCase();
  return mode || 'demo';
}

function curatedProducts() {
  return [
    {
      nameEn: 'Cigratte',
      imageQuery: 'cigarette',
      variants: [
        { packLabel: 'Dando', packUnit: 'dando', baseUnitLabel: 'pcs', baseUnitsPerPack: 20, purchase: 26, sell: 29.66, mrp: 32, packQty: 50 },
        { packLabel: 'Box', packUnit: 'box', baseUnitLabel: 'pcs', baseUnitsPerPack: 200, purchase: 2500, sell: 2750, mrp: 3000, packQty: 5 },
      ],
    },
    {
      nameEn: 'Tambaku',
      imageQuery: 'tobacco',
      variants: [
        { packLabel: 'Patti', packUnit: 'patti', baseUnitLabel: 'pcs', baseUnitsPerPack: 20, purchase: 18, sell: 22, mrp: 25, packQty: 200 },
        { packLabel: 'Jumbo', packUnit: 'jumbo', baseUnitLabel: 'pcs', baseUnitsPerPack: 500, purchase: 7200, sell: 8200, mrp: 9000, packQty: 2 },
      ],
    },
    {
      nameEn: 'Milk',
      imageQuery: 'milk',
      variants: [
        { packLabel: '500 ml', packUnit: 'ml', baseUnitLabel: 'ml', baseUnitsPerPack: 500, purchase: 26, sell: 30, mrp: 34, packQty: 120 },
        { packLabel: '1 liter', packUnit: 'liter', baseUnitLabel: 'ml', baseUnitsPerPack: 1000, purchase: 50, sell: 58, mrp: 64, packQty: 80 },
      ],
    },
    {
      nameEn: 'Sugar',
      imageQuery: 'sugar',
      variants: [
        { packLabel: '500 gm', packUnit: 'gm', baseUnitLabel: 'gram', baseUnitsPerPack: 500, purchase: 22, sell: 26, mrp: 30, packQty: 100 },
        { packLabel: '1 kg', packUnit: 'kg', baseUnitLabel: 'gram', baseUnitsPerPack: 1000, purchase: 42, sell: 50, mrp: 60, packQty: 80 },
      ],
    },
    {
      nameEn: 'Sopari',
      imageQuery: 'betel nut',
      variants: [
        { packLabel: '250 gm', packUnit: 'gm', baseUnitLabel: 'gram', baseUnitsPerPack: 250, purchase: 180, sell: 200, mrp: 220, packQty: 40 },
        { packLabel: '1 kg', packUnit: 'kg', baseUnitLabel: 'gram', baseUnitsPerPack: 1000, purchase: 650, sell: 720, mrp: 800, packQty: 10 },
      ],
    },
    {
      nameEn: 'Colddrinks',
      imageQuery: 'soft drink',
      variants: [
        { packLabel: 'Carat', packUnit: 'carat', baseUnitLabel: 'pcs', baseUnitsPerPack: 24, purchase: 360, sell: 420, mrp: 480, packQty: 10 },
        { packLabel: 'Pcs', packUnit: 'pcs', baseUnitLabel: 'pcs', baseUnitsPerPack: 1, purchase: 12, sell: 15, mrp: 18, packQty: 200 },
      ],
    },
  ];
}

function unsplashImage(query, size = '800x800') {
  const q = encodeURIComponent(String(query || 'product'));
  return `https://source.unsplash.com/${size}/?${q}`;
}


function buildDemoProducts() {
  const P = (nameEn, variants) => ({ name: { en: nameEn }, variants });
  const V = (label, baseUnitLabel, baseUnitsPerPack, purchasePrice, sellPrice, mrp, packQty, unitGuess) => ({
    label,
    baseUnitLabel,
    baseUnitsPerPack,
    purchasePrice,
    sellPrice,
    mrp,
    packQty,
    unitGuess,
  });

  return [
    P('Sopari Premium', [
      V('250 gram', 'gram', 250, 180, 200, 220, 20, 'gram'),
      V('500 gram', 'gram', 500, 340, 380, 420, 15, 'gram'),
      V('1 kg', 'gram', 1000, 650, 720, 800, 10, 'gram'),
    ]),
    P('Cigarette Classic', [
      V('Dando', 'pcs', 20, 260, 290, 320, 50, 'pcs'),
      V('Box', 'pcs', 200, 2500, 2750, 3000, 10, 'pcs'),
    ]),
    P('Tambaku Regular', [
      V('Padiki', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
      V('Dabba', 'pcs', 50, 800, 950, 1100, 15, 'pcs'),
      V('Jumbo Box', 'pcs', 500, 7200, 8200, 9000, 4, 'pcs'),
    ]),
    P('Soda Bottle', [
      V('300 ml bottle crate', 'pcs', 24, 360, 420, 480, 8, 'pcs'),
      V('500 ml bottle crate', 'pcs', 24, 480, 560, 640, 6, 'pcs'),
      V('1 liter bottle crate', 'pcs', 12, 360, 420, 480, 6, 'pcs'),
    ]),
    P('Red Bull', [V('250 ml can pack', 'pcs', 24, 2200, 2600, 2900, 6, 'pcs')]),
    P('Dragon Energy', [V('250 ml can pack', 'pcs', 24, 1600, 1900, 2200, 6, 'pcs')]),
    P('Cooking Oil', [
      V('1 liter pouch', 'ml', 1000, 140, 160, 180, 50, 'ml'),
      V('5 liter can', 'ml', 5000, 680, 760, 820, 12, 'ml'),
    ]),
    P('Wafers', [
      V('Small packet', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Family pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Namkeen Mix', [
      V('200 gram pack', 'gram', 200, 40, 50, 60, 120, 'gram'),
      V('500 gram pack', 'gram', 500, 90, 110, 130, 80, 'gram'),
    ]),
    P('Sabu Soap', [
      V('Single bar', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
      V('Box (48 bars)', 'pcs', 48, 800, 950, 1100, 10, 'pcs'),
    ]),
    P('Chips', [
      V('Small pack', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Big pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Tea', [
      V('250 gram', 'gram', 250, 120, 140, 160, 60, 'gram'),
      V('1 kg', 'gram', 1000, 420, 480, 550, 20, 'gram'),
    ]),
    P('Sugar', [
      V('1 kg', 'gram', 1000, 42, 50, 60, 80, 'gram'),
      V('5 kg', 'gram', 5000, 200, 230, 260, 20, 'gram'),
    ]),
    P('Salt', [
      V('1 kg', 'gram', 1000, 18, 22, 28, 80, 'gram'),
      V('5 kg', 'gram', 5000, 80, 95, 110, 20, 'gram'),
    ]),
    P('Toothpaste', [
      V('100 gram', 'gram', 100, 55, 65, 75, 120, 'gram'),
      V('200 gram', 'gram', 200, 95, 110, 130, 80, 'gram'),
    ]),
    P('Shampoo', [
      V('100 ml', 'ml', 100, 55, 65, 75, 120, 'ml'),
      V('500 ml', 'ml', 500, 220, 260, 300, 40, 'ml'),
    ]),
    P('Biscuits', [
      V('Single pack', 'pcs', 1, 8, 10, 12, 300, 'pcs'),
      V('Family pack', 'pcs', 1, 18, 22, 25, 200, 'pcs'),
    ]),
    P('Masala', [
      V('100 gram', 'gram', 100, 30, 36, 42, 150, 'gram'),
      V('500 gram', 'gram', 500, 130, 150, 170, 60, 'gram'),
    ]),
    P('Milk', [
      V('500 ml', 'ml', 500, 26, 30, 34, 120, 'ml'),
      V('1 liter', 'ml', 1000, 50, 58, 64, 80, 'ml'),
    ]),
  ];
}

async function ensureCoreSetup(t) {
  // volumes: pcs/gram/ml
  // also pack-type units used in tobacco retail
  const need = ['pcs', 'gram', 'ml', 'dando', 'box', 'patti', 'jumbo', 'liter', 'gm', 'kg', 'carat', 'padiki'];
  const existing = await Volume.findAll({ transaction: t });
  const byName = new Map(existing.map((v) => [String(v.name?.en || Object.values(v.name || {})[0] || '').toLowerCase(), v]));

  for (const n of need) {
    if (!byName.has(n)) {
      const row = await Volume.create({ name: { en: n }, status: 'Active' }, { transaction: t });
      byName.set(n, row);
    }
  }

  let level = await CustomLevel.findOne({ where: { status: 'Active' }, transaction: t });
  if (!level) {
    level = await CustomLevel.create({ name: 'Default', status: 'Active' }, { transaction: t });
  }

  let main = await MainCategory.findOne({ where: { status: 'Active' }, transaction: t });
  if (!main) {
    main = await MainCategory.create({ title: { en: 'General' }, status: 'Active' }, { transaction: t });
  }

  let sub = await SubCategory.findOne({ where: { status: 'Active', mainCategoryId: main.id }, transaction: t });
  if (!sub) {
    sub = await SubCategory.create({ title: { en: 'General' }, mainCategoryId: main.id, status: 'Active' }, { transaction: t });
  }

  let company = await CompanyCategory.findOne({ where: { status: 'Active' }, transaction: t });
  if (!company) {
    company = await CompanyCategory.create({ title: { en: 'General' }, status: 'Active' }, { transaction: t });
  }

  let godown = await Godown.findOne({ where: { status: 'Active' }, transaction: t });
  if (!godown) {
    godown = await Godown.create({ name: 'Main Godown', type: 'Main', status: 'Active' }, { transaction: t });
  }

  return { volumesByName: byName, level, main, sub, company, godown };
}

async function findProductByEnName(enName, transaction) {
  const rows = await Product.findAll({ where: { status: { [Op.ne]: 'Deleted' } }, transaction });
  return rows.find((p) => String(p?.name?.en || '').trim().toLowerCase() === String(enName).trim().toLowerCase()) || null;
}

async function ensureCigaretteAndTambaku(core, t) {
  // Ensure two key demo products exist exactly as requested, even if other products already exist
  const productsToEnsure = [
    {
      nameEn: 'Cigarette (Dando + Box)',
      variants: [
        { packUnit: 'dando', packLabel: 'Dando', baseUnitLabel: 'pcs', baseUnitsPerPack: 20, purchase: 26, sell: 29.66, mrp: 32, packQty: 50 },
        { packUnit: 'box', packLabel: 'Box', baseUnitLabel: 'pcs', baseUnitsPerPack: 200, purchase: 2500, sell: 2750, mrp: 3000, packQty: 5 },
      ],
    },
    {
      nameEn: 'Tambaku (Jumbo 500 Padiki)',
      variants: [
        { packUnit: 'jumbo', packLabel: 'Jumbo', baseUnitLabel: 'pcs', baseUnitsPerPack: 500, purchase: 7200, sell: 8200, mrp: 9000, packQty: 2 },
      ],
    },
  ];

  const pcsUnit = core.volumesByName.get('pcs') || Array.from(core.volumesByName.values())[0];

  for (const p of productsToEnsure) {
    let product = await findProductByEnName(p.nameEn, t);
    if (!product) {
      product = await Product.create({
        name: { en: p.nameEn },
        thumbnail: 'https://picsum.photos/seed/apnatobacco-special/256/256',
        images: ['https://picsum.photos/seed/apnatobacco-special-1/800/800'],
        mainCategoryId: core.main.id,
        subCategoryId: core.sub.id,
        companyCategoryId: core.company.id,
        productDescription: { keyInformation: [], nutritionalInformation: [], info: [] },
        status: 'Active',
      }, { transaction: t });
    }

    // Create variants if missing (by volume string)
    for (const vv of p.variants) {
      const packUnitRow = core.volumesByName.get(String(vv.packUnit).toLowerCase()) || pcsUnit;
      const volumeString = `1 ${vv.packLabel}`.trim();
      let variant = await ProductVariant.findOne({
        where: { productId: product.id, volume: volumeString, status: { [Op.ne]: 'Deleted' } },
        transaction: t,
      });

      if (!variant) {
        variant = await ProductVariant.create({
          productId: product.id,
          volume: volumeString,
          purchasePrice: Number(vv.purchase),
          baseUnitLabel: String(vv.baseUnitLabel || 'pcs'),
          baseUnitsPerPack: Number(vv.baseUnitsPerPack || 1),
          status: 'Active',
        }, { transaction: t });

        await ProductPricing.create({
          variantId: variant.id,
          customLevelId: core.level.id,
          quantityRange: '1-999999',
          minQty: 1,
          maxQty: 999999,
          purchasePrice: Number(vv.purchase),
          price: Number(vv.sell),
          mrp: Number(vv.mrp),
          status: 'Active',
        }, { transaction: t });
      }

      // Inventory purchase in BASE units (pcs) — so stock math stays consistent
      const baseUnits = Number(vv.packQty) * Number(vv.baseUnitsPerPack);
      await applyPurchase({
        productId: product.id,
        variantId: variant.id,
        godownId: core.godown.id,
        primaryUnitId: pcsUnit.id,
        qtyBaseUnits: baseUnits,
        pricePerBaseUnit: Number(vv.purchase),
        note: `Seed special: ${vv.packQty} ${vv.packLabel} (1 ${vv.packLabel} = ${vv.baseUnitsPerPack} pcs)`,
        transaction: t,
      });

      // Keep linter happy with unused packUnitRow (future use)
      void packUnitRow;
    }
  }
}

async function applyPurchase({ productId, variantId, godownId, primaryUnitId, qtyBaseUnits, pricePerBaseUnit, note, transaction }) {
  let stock = await InventoryStock.findOne({ where: { productId, variantId, godownId }, transaction });
  if (!stock) {
    stock = await InventoryStock.create({
      productId,
      variantId,
      godownId,
      primaryUnitId,
      secondaryUnitId: null,
      secondaryPerPrimary: 1,
      totalBaseUnits: 0,
      avgPurchasePricePerBaseUnit: 0,
      status: 'Active',
    }, { transaction });
  }

  const oldQty = Number(stock.totalBaseUnits || 0);
  const oldAvg = Number(stock.avgPurchasePricePerBaseUnit || 0);
  const addQty = Number(qtyBaseUnits || 0);
  const unitPrice = Number(pricePerBaseUnit || 0);
  const newQty = oldQty + addQty;
  const newAvg = newQty === 0 ? 0 : round2(((oldQty * oldAvg) + (addQty * unitPrice)) / newQty);

  await stock.update({ totalBaseUnits: newQty, avgPurchasePricePerBaseUnit: newAvg, primaryUnitId }, { transaction });

  await InventoryTransaction.create({
    stockId: stock.id,
    productId,
    variantId,
    godownId,
    type: 'PURCHASE',
    primaryUnitId,
    secondaryUnitId: null,
    secondaryPerPrimary: 1,
    qtyPrimary: addQty,
    qtySecondary: 0,
    totalQtyBaseUnits: addQty,
    purchasePricePerBaseUnit: unitPrice,
    avgPriceAfterTxn: newAvg,
    balanceAfterBaseUnits: newQty,
    note: note || 'Seed purchase',
  }, { transaction });
}

async function wipeAllProductsAndInventory(t) {
  await InventoryTransaction.destroy({ where: {}, force: true, transaction: t });
  await InventoryStock.destroy({ where: {}, force: true, transaction: t });
  await ProductPricing.destroy({ where: {}, force: true, transaction: t });
  await ProductVariant.destroy({ where: {}, force: true, transaction: t });
  await Product.destroy({ where: {}, force: true, transaction: t });
}

async function seedCurated(core, t) {
  const list = curatedProducts();

  for (const p of list) {
    const product = await Product.create({
      name: { en: p.nameEn },
      thumbnail: unsplashImage(p.imageQuery, '256x256'),
      images: [unsplashImage(p.imageQuery, '800x800')],
      mainCategoryId: core.main.id,
      subCategoryId: core.sub.id,
      companyCategoryId: core.company.id,
      productDescription: { keyInformation: [], nutritionalInformation: [], info: [] },
      status: 'Active',
    }, { transaction: t });

    for (const vv of p.variants) {
      const baseUnitRow = core.volumesByName.get(baseUnitLabelToVolumeName(vv.baseUnitLabel)) || core.volumesByName.get('pcs');
      const variant = await ProductVariant.create({
        productId: product.id,
        volume: `1 ${vv.packLabel}`.trim(),
        purchasePrice: Number(vv.purchase),
        baseUnitLabel: String(vv.baseUnitLabel || 'pcs'),
        baseUnitsPerPack: Number(vv.baseUnitsPerPack || 1),
        status: 'Active',
      }, { transaction: t });

      await ProductPricing.create({
        variantId: variant.id,
        customLevelId: core.level.id,
        quantityRange: '1-999999',
        minQty: 1,
        maxQty: 999999,
        purchasePrice: Number(vv.purchase),
        price: Number(vv.sell),
        mrp: Number(vv.mrp),
        status: 'Active',
      }, { transaction: t });

      const baseUnits = Number(vv.packQty) * Number(vv.baseUnitsPerPack);
      await applyPurchase({
        productId: product.id,
        variantId: variant.id,
        godownId: core.godown.id,
        primaryUnitId: baseUnitRow.id,
        qtyBaseUnits: baseUnits,
        pricePerBaseUnit: Number(vv.purchase),
        note: `Curated seed: ${vv.packQty} ${vv.packLabel} (1 ${vv.packLabel} = ${vv.baseUnitsPerPack} ${vv.baseUnitLabel})`,
        transaction: t,
      });
    }
  }
}

export async function seedDemoIfNeeded() {
  const enabled = String(process.env.SEED_DEMO || '').toLowerCase() === 'true';
  if (!enabled) return { ran: false, reason: 'SEED_DEMO not enabled' };
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return { ran: false, reason: 'Disabled in production' };
  }

  const t = await sequelize.transaction();
  try {
    const core = await ensureCoreSetup(t);
    const mode = getSeedMode();
    const reset = envBool('SEED_RESET', false);

    if (mode === 'curated') {
      if (reset) {
        await wipeAllProductsAndInventory(t);
      } else {
        const existingCount = await Product.count({ transaction: t });
        if (existingCount > 0) {
          await t.commit();
          return { ran: false, reason: 'SEED_MODE=curated but products exist (set SEED_RESET=true to wipe + seed)' };
        }
      }
      await seedCurated(core, t);
      await t.commit();
      return { ran: true, reason: reset ? 'Curated seed (reset + seed)' : 'Curated seed' };
    }

    // Always ensure these two key products exist (idempotent)
    await ensureCigaretteAndTambaku(core, t);

    const existing = await Product.findOne({ where: { status: { [Op.ne]: 'Deleted' } }, transaction: t });
    if (existing) {
      await t.commit();
      return { ran: true, reason: 'Ensured cigarette/tambaku (products already existed, skipped full demo)' };
    }

    const demo = buildDemoProducts();

    for (const p of demo) {
      const product = await Product.create({
        name: p.name,
        thumbnail: 'https://picsum.photos/seed/apnatobacco/256/256',
        images: ['https://picsum.photos/seed/apnatobacco-1/800/800'],
        mainCategoryId: core.main.id,
        subCategoryId: core.sub.id,
        companyCategoryId: core.company.id,
        productDescription: { keyInformation: [], nutritionalInformation: [], info: [] },
        status: 'Active',
      }, { transaction: t });

      for (const vv of p.variants) {
        const unitName = baseUnitLabelToVolumeName(vv.unitGuess || vv.baseUnitLabel);
        const volumeUnit = core.volumesByName.get(unitName) || Array.from(core.volumesByName.values())[0];
        const volumeValueMatch = String(vv.label).match(/^([\d.]+)/);
        const volumeValue = volumeValueMatch ? volumeValueMatch[1] : '1';
        const normalizedVolume = `${volumeValue} ${volumeUnit?.name?.en || unitName}`.trim();

        const variant = await ProductVariant.create({
          productId: product.id,
          volume: normalizedVolume,
          purchasePrice: Number(vv.purchasePrice),
          baseUnitLabel: String(vv.baseUnitLabel || 'pcs'),
          baseUnitsPerPack: Number(vv.baseUnitsPerPack || 1),
          status: 'Active',
        }, { transaction: t });

        await ProductPricing.create({
          variantId: variant.id,
          customLevelId: core.level.id,
          quantityRange: '1-999999',
          minQty: 1,
          maxQty: 999999,
          purchasePrice: Number(vv.purchasePrice),
          price: Number(vv.sellPrice),
          mrp: Number(vv.mrp),
          status: 'Active',
        }, { transaction: t });

        const baseUnits = Number(vv.packQty) * Number(vv.baseUnitsPerPack);
        await applyPurchase({
          productId: product.id,
          variantId: variant.id,
          godownId: core.godown.id,
          primaryUnitId: volumeUnit.id,
          qtyBaseUnits: baseUnits,
          pricePerBaseUnit: Number(vv.purchasePrice),
          note: `Seed: ${vv.packQty} pack(s) of ${vv.label}`,
          transaction: t,
        });
      }
    }

    await t.commit();
    return { ran: true, reason: 'Seed completed' };
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

