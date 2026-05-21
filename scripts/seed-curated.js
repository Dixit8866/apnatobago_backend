import dotenv from 'dotenv';
dotenv.config();

import { Op } from 'sequelize';
import sequelize from '../config/db.js';
import './ensure-db.js';

import Admin from '../models/superadmin-models/Admin.js';
import Language from '../models/superadmin-models/Language.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../models/superadmin-models/CompanyCategory.js';
import Volume from '../models/superadmin-models/Volume.js';
import CustomLevel from '../models/superadmin-models/CustomLevel.js';
import Godown from '../models/superadmin-models/Godown.js';
import Product from '../models/superadmin-models/Product.js';
import ProductVariant from '../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../models/superadmin-models/ProductPricing.js';
import InventoryStock from '../models/superadmin-models/InventoryStock.js';
import InventoryTransaction from '../models/superadmin-models/InventoryTransaction.js';

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || v === '') return fallback;
  return String(v).toLowerCase() === 'true' || String(v) === '1';
}

function unsplashImage(query, size = '800x800') {
  const q = encodeURIComponent(String(query || 'product'));
  return `https://source.unsplash.com/${size}/?${q}`;
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

async function wipeAllExceptAdmin(t) {
  await InventoryTransaction.destroy({ where: {}, force: true, transaction: t });
  await InventoryStock.destroy({ where: {}, force: true, transaction: t });
  await ProductPricing.destroy({ where: {}, force: true, transaction: t });
  await ProductVariant.destroy({ where: {}, force: true, transaction: t });
  await Product.destroy({ where: {}, force: true, transaction: t });
  await CustomLevel.destroy({ where: {}, force: true, transaction: t });
  await Volume.destroy({ where: {}, force: true, transaction: t });
  await Godown.destroy({ where: {}, force: true, transaction: t });
  await SubCategory.destroy({ where: {}, force: true, transaction: t });
  await MainCategory.destroy({ where: {}, force: true, transaction: t });
  await CompanyCategory.destroy({ where: {}, force: true, transaction: t });
  await Language.destroy({ where: {}, force: true, transaction: t });
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
    note: note || 'Curated seed purchase',
  }, { transaction });
}

function curatedProducts() {
  return [
    {
      nameEn: 'Cigratte',
      nameGu: 'સિગરેટ',
      query: 'cigarette',
      variants: [
        // base unit = Box (NO pcs)
        // 1 Dando = 20 Box, 1 Box = 1 Box
        { packLabel: 'Dando', baseUnitLabel: 'box', baseUnitsPerPack: 20, purchase: 900, sell: 1000, mrp: 1100, packQty: 5 },
        { packLabel: 'Box', baseUnitLabel: 'box', baseUnitsPerPack: 1, purchase: 45, sell: 55, mrp: 60, packQty: 80 },
      ],
    },
    {
      nameEn: 'Tambaku',
      nameGu: 'તમાકુ',
      query: 'tobacco',
      variants: [
        // base unit = pcs (smallest)
        // 1 Patti = 20 pcs, 1 Jumbo = 25 Patti = 500 pcs
        { packLabel: 'Patti', baseUnitLabel: 'pcs', baseUnitsPerPack: 20, purchase: 18, sell: 22, mrp: 25, packQty: 200 },
        { packLabel: 'Jumbo', baseUnitLabel: 'pcs', baseUnitsPerPack: 500, purchase: 450, sell: 520, mrp: 600, packQty: 20 },
      ],
    },
    {
      nameEn: 'Milk',
      nameGu: 'દૂધ',
      query: 'milk',
      variants: [
        { packLabel: '500 ml', baseUnitLabel: 'ml', baseUnitsPerPack: 500, purchase: 26, sell: 30, mrp: 34, packQty: 120 },
        { packLabel: '1 liter', baseUnitLabel: 'ml', baseUnitsPerPack: 1000, purchase: 50, sell: 58, mrp: 64, packQty: 80 },
      ],
    },
    {
      nameEn: 'Sugar',
      nameGu: 'ખાંડ',
      query: 'sugar',
      variants: [
        { packLabel: '500 gm', baseUnitLabel: 'gram', baseUnitsPerPack: 500, purchase: 22, sell: 26, mrp: 30, packQty: 100 },
        { packLabel: '1 kg', baseUnitLabel: 'gram', baseUnitsPerPack: 1000, purchase: 42, sell: 50, mrp: 60, packQty: 80 },
      ],
    },
    {
      nameEn: 'Sopari',
      nameGu: 'સોપારી',
      query: 'betel nut',
      variants: [
        { packLabel: '250 gm', baseUnitLabel: 'gram', baseUnitsPerPack: 250, purchase: 180, sell: 200, mrp: 220, packQty: 40 },
        { packLabel: '1 kg', baseUnitLabel: 'gram', baseUnitsPerPack: 1000, purchase: 650, sell: 720, mrp: 800, packQty: 10 },
      ],
    },
    {
      nameEn: 'Colddrinks',
      nameGu: 'ઠંડા પીણા',
      query: 'soft drink',
      variants: [
        { packLabel: 'Carat', baseUnitLabel: 'pcs', baseUnitsPerPack: 24, purchase: 360, sell: 420, mrp: 480, packQty: 10 },
        { packLabel: 'Pcs', baseUnitLabel: 'pcs', baseUnitsPerPack: 1, purchase: 12, sell: 15, mrp: 18, packQty: 200 },
      ],
    },
  ];
}

async function ensureBasics(t) {
  // base units
  const need = ['pcs', 'gram', 'ml', 'box', 'patti', 'dando', 'jumbo', 'liter', 'gm', 'kg', 'carat'];
  const existingRows = await Volume.findAll({ transaction: t });
  const existingNames = new Set(
    existingRows.map((v) => String(v?.name?.en || Object.values(v?.name || {})[0] || '').trim().toLowerCase()).filter(Boolean)
  );
  for (const u of need) {
    if (!existingNames.has(u)) {
      await Volume.create({ name: { en: u }, status: 'Active' }, { transaction: t });
    }
  }

  let level = await CustomLevel.findOne({ where: { status: 'Active' }, transaction: t });
  if (!level) level = await CustomLevel.create({ name: 'Default', status: 'Active' }, { transaction: t });

  let godown = await Godown.findOne({ where: { status: 'Active' }, transaction: t });
  if (!godown) godown = await Godown.create({ name: 'Main Godown', type: 'main', status: 'Active' }, { transaction: t });

  let main = await MainCategory.findOne({ where: { status: 'Active' }, transaction: t });
  if (!main) {
    main = await MainCategory.create({
      title: { en: 'Products', gu: 'ઉત્પાદનો' },
      image: unsplashImage('grocery store', '512x512'),
      status: 'Active',
    }, { transaction: t });
  }

  let sub = await SubCategory.findOne({ where: { status: 'Active', mainCategoryId: main.id }, transaction: t });
  if (!sub) {
    sub = await SubCategory.create({
      mainCategoryId: main.id,
      title: { en: 'Retail', gu: 'રિટેલ' },
      image: unsplashImage('retail shop', '512x512'),
      status: 'Active',
    }, { transaction: t });
  }

  let company = await CompanyCategory.findOne({ where: { status: 'Active' }, transaction: t });
  if (!company) {
    company = await CompanyCategory.create({
      title: { en: 'General', gu: 'જનરલ' },
      image: unsplashImage('brand', '512x512'),
      status: 'Active',
    }, { transaction: t });
  }

  const volumes = await Volume.findAll({ transaction: t });
  const byName = new Map(volumes.map((v) => [String(v.name?.en || Object.values(v.name || {})[0] || '').toLowerCase(), v]));

  return { level, godown, main, sub, company, volumeByName: byName };
}

async function run() {
  const env = String(process.env.NODE_ENV || '').toLowerCase();
  const force = envBool('WIPE_FORCE', false);
  if (env === 'production' && !force) {
    throw new Error('Refusing to run curated seed in production without WIPE_FORCE=true');
  }

  await sequelize.authenticate();
  const t = await sequelize.transaction();
  try {
    // wipe everything except Admin
    await wipeAllExceptAdmin(t);
    const adminsLeft = await Admin.count({ transaction: t });
    if (adminsLeft < 1) {
      throw new Error('No Admin found. Please create admin first.');
    }

    const basics = await ensureBasics(t);
    const list = curatedProducts();

    for (const p of list) {
      const product = await Product.create({
        name: { en: p.nameEn, gu: p.nameGu },
        thumbnail: unsplashImage(p.query, '256x256'),
        images: [unsplashImage(p.query, '800x800')],
        mainCategoryId: basics.main.id,
        subCategoryId: basics.sub.id,
        companyCategoryId: basics.company.id,
        productDescription: { keyInformation: [], nutritionalInformation: [], info: [] },
        status: 'Active',
      }, { transaction: t });

      for (const vv of p.variants) {
        const rawBase = String(vv.baseUnitLabel || '').toLowerCase();
        const baseUnitKey =
          rawBase === 'ml'
            ? 'ml'
            : (rawBase === 'gram' || rawBase === 'gm' || rawBase === 'g')
              ? 'gram'
              : (rawBase === 'box')
                ? 'box'
                : 'pcs';
        const baseUnitRow = basics.volumeByName.get(baseUnitKey);
        if (!baseUnitRow) throw new Error(`Missing base unit volume: ${baseUnitKey}`);

        const variant = await ProductVariant.create({
          productId: product.id,
          volume: String(vv.packLabel || '').trim(),
          purchasePrice: Number(vv.purchase),
          baseUnitLabel: baseUnitKey,
          baseUnitsPerPack: Number(vv.baseUnitsPerPack),
          status: 'Active',
        }, { transaction: t });

        await ProductPricing.create({
          variantId: variant.id,
          customLevelId: basics.level.id,
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
          godownId: basics.godown.id,
          primaryUnitId: baseUnitRow.id,
          qtyBaseUnits: baseUnits,
          pricePerBaseUnit: Number(vv.purchase),
          note: `Seed: ${vv.packQty} ${vv.packLabel} (1 ${vv.packLabel} = ${vv.baseUnitsPerPack} ${baseUnitKey})`,
          transaction: t,
        });
      }
    }

    await t.commit();
    console.log('[Seed] Curated seed completed (6 products only).');
  } catch (e) {
    await t.rollback();
    throw e;
  } finally {
    await sequelize.close();
  }
}

run().catch((e) => {
  console.error('[Seed] Failed:', e.message);
  process.exit(1);
});

