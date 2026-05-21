import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import Admin from '../models/superadmin-models/Admin.js';
import Godown from '../models/superadmin-models/Godown.js';
import GodownStaff from '../models/superadmin-models/GodownStaff.js';
import Language from '../models/superadmin-models/Language.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../models/superadmin-models/CompanyCategory.js';
import Volume from '../models/superadmin-models/Volume.js';
import CustomLevel from '../models/superadmin-models/CustomLevel.js';
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

async function main() {
  const force = envBool('WIPE_FORCE', false);
  const env = String(process.env.NODE_ENV || '').toLowerCase();

  if (env === 'production' && !force) {
    throw new Error('Refusing to wipe in production. Set WIPE_FORCE=true if you really want this.');
  }

  await sequelize.authenticate();

  const t = await sequelize.transaction();
  try {
    // Hard delete everything except Admin
    await InventoryTransaction.destroy({ where: {}, force: true, transaction: t });
    await InventoryStock.destroy({ where: {}, force: true, transaction: t });

    await ProductPricing.destroy({ where: {}, force: true, transaction: t });
    await ProductVariant.destroy({ where: {}, force: true, transaction: t });
    await Product.destroy({ where: {}, force: true, transaction: t });

    await CustomLevel.destroy({ where: {}, force: true, transaction: t });
    await Volume.destroy({ where: {}, force: true, transaction: t });

    await GodownStaff.destroy({ where: {}, force: true, transaction: t });
    await Godown.destroy({ where: {}, force: true, transaction: t });

    await SubCategory.destroy({ where: {}, force: true, transaction: t });
    await MainCategory.destroy({ where: {}, force: true, transaction: t });
    await CompanyCategory.destroy({ where: {}, force: true, transaction: t });

    await Language.destroy({ where: {}, force: true, transaction: t });

    const adminsLeft = await Admin.count({ transaction: t });
    await t.commit();

    console.log(`[Wipe] Completed. Admin rows kept: ${adminsLeft}`);
  } catch (e) {
    await t.rollback();
    throw e;
  } finally {
    await sequelize.close();
  }
}

main().catch((e) => {
  console.error('[Wipe] Failed:', e.message);
  process.exit(1);
});

