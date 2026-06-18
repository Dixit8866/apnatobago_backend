import dotenv from 'dotenv';
dotenv.config();

import sequelize from '../config/db.js';
import '../models/index.js';

import Product from '../models/superadmin-models/Product.js';
import ProductVariant from '../models/superadmin-models/ProductVariant.js';
import ProductPricing from '../models/superadmin-models/ProductPricing.js';
import MainCategory from '../models/superadmin-models/MainCategory.js';
import SubCategory from '../models/superadmin-models/SubCategory.js';
import CompanyCategory from '../models/superadmin-models/CompanyCategory.js';
import Volume from '../models/superadmin-models/Volume.js';
import CustomLevel from '../models/superadmin-models/CustomLevel.js';

const CustomLevelData = [
  {
    "id": "18992e0e-6587-49dd-b163-fa174a6a277e",
    "name": "Basic",
    "status": "Active",
    "createdAt": "2026-05-20 13:27:58.106+00",
    "updatedAt": "2026-05-26 08:48:40.629+00",
    "deletedAt": "2026-06-02 17:52:18.759+00",
  },
  {
    "id": "6b0722c6-ee28-4058-b4de-a961d1b16da0",
    "name": "Premium",
    "status": "Active",
    "createdAt": "2026-05-20 13:27:58.106+00",
    "updatedAt": "2026-05-26 08:48:40.629+00",
    "deletedAt": "2026-06-02 17:52:18.759+00",
  },
  {
    "id": "ec6295ab-0e66-46b2-8678-16199860f947",
    "name": "Standard",
    "status": "Active",
    "createdAt": "2026-05-20 13:27:58.106+00",
    "updatedAt": "2026-05-26 08:48:40.629+00",
    "deletedAt": "2026-06-02 17:52:18.759+00",
  },
]

async function seed() {
  console.log('[Seed] Starting Seeding from Static Data...');
  try {
    await sequelize.authenticate();
    console.log('[Seed] DB Connection authenticated successfully.');

    const t = await sequelize.transaction();

    try {
      console.log('[Seed] Ensuring referenced master categories/volumes/custom levels exist...');

      const mainCategoryIds = new Set();
      const subCategoryIds = new Set();
      const companyCategoryIds = new Set();
      const volumeIds = new Set();
      const customLevelIds = new Set();

      for (const p of products) {
        if (p.mainCategoryId) mainCategoryIds.add(p.mainCategoryId);
        if (p.subCategoryId) subCategoryIds.add(p.subCategoryId);
        if (p.companyCategoryId) companyCategoryIds.add(p.companyCategoryId);
      }

      for (const v of variants) {
        if (v.volumeId) volumeIds.add(v.volumeId);
        if (v.baseUnitLabel) volumeIds.add(v.baseUnitLabel);
        if (v.innerUnitLabel) volumeIds.add(v.innerUnitLabel);
      }

      for (const pr of pricings) {
        if (pr.customLevelId) customLevelIds.add(pr.customLevelId);
      }

      // 1. Ensure Main Categories exist
      for (const id of mainCategoryIds) {
        const exists = await MainCategory.findByPk(id, { transaction: t });
        if (!exists) {
          await MainCategory.create({
            id,
            title: { en: `Main Category ${id}` },
            image: '',
            status: 'Active'
          }, { transaction: t });
          console.log(`[Seed] Created default MainCategory: ${id}`);
        }
      }

      // 2. Ensure Sub Categories exist
      for (const id of subCategoryIds) {
        const exists = await SubCategory.findByPk(id, { transaction: t });
        if (!exists) {
          const productWithSub = products.find(p => p.subCategoryId === id);
          const mId = productWithSub ? productWithSub.mainCategoryId : Array.from(mainCategoryIds)[0];
          await SubCategory.create({
            id,
            mainCategoryId: mId,
            title: { en: `Sub Category ${id}` },
            image: '',
            status: 'Active'
          }, { transaction: t });
          console.log(`[Seed] Created default SubCategory: ${id}`);
        }
      }

      // 3. Ensure Company Categories exist
      for (const id of companyCategoryIds) {
        const exists = await CompanyCategory.findByPk(id, { transaction: t });
        if (!exists) {
          await CompanyCategory.create({
            id,
            title: { en: `Company Category ${id}` },
            image: '',
            status: 'Active'
          }, { transaction: t });
          console.log(`[Seed] Created default CompanyCategory: ${id}`);
        }
      }

      // 4. Ensure Volumes exist
      for (const id of volumeIds) {
        const exists = await Volume.findByPk(id, { transaction: t });
        if (!exists) {
          await Volume.create({
            id,
            name: { en: `Volume ${id}` },
            status: 'Active'
          }, { transaction: t });
          console.log(`[Seed] Created default Volume: ${id}`);
        }
      }

      // 5. Ensure Custom Levels exist
      for (const id of CustomLevelData) {
        const exists = await CustomLevel.findByPk(id, { transaction: t });
        if (!exists) {
          await CustomLevel.create({
            id,
            name: `Level ${id}`,
            status: 'Active'
          }, { transaction: t });
          console.log(`[Seed] Created default CustomLevel: ${id}`);
        }
      }

      // 6. Seeding Products
      console.log('[Seed] Seeding Products...');
      const productFields = Object.keys(Product.rawAttributes);
      await Product.bulkCreate(products, {
        updateOnDuplicate: productFields,
        transaction: t,
        paranoid: false
      });
      console.log('[Seed] Seeding Products completed.');

      // 7. Seeding Product Variants
      console.log('[Seed] Seeding Product Variants...');
      const variantFields = Object.keys(ProductVariant.rawAttributes);
      await ProductVariant.bulkCreate(variants, {
        updateOnDuplicate: variantFields,
        transaction: t,
        paranoid: false
      });
      console.log('[Seed] Seeding Product Variants completed.');

      // 8. Seeding Product Pricings
      console.log('[Seed] Seeding Product Pricings...');
      const pricingFields = Object.keys(ProductPricing.rawAttributes);
      await ProductPricing.bulkCreate(pricings, {
        updateOnDuplicate: pricingFields,
        transaction: t,
        paranoid: false
      });
      console.log('[Seed] Seeding Product Pricings completed.');

      await t.commit();
      console.log('[Seed] All products, variants, and pricings imported statically successfully ✓');
      process.exit(0);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  } catch (error) {
    console.error('[Seed Error] Failed to seed from static data:', error.message);
    process.exit(1);
  }
}

seed();
