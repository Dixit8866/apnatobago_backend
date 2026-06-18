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

// Make sure these imports exist
import products from './products.js';
import variants from './variants.js';
import pricings from './pricings.js';

const customLevelsData = [
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
      console.log(
        '[Seed] Ensuring referenced master categories/volumes/custom levels exist...'
      );

      const mainCategoryIds = new Set();
      const subCategoryIds = new Set();
      const companyCategoryIds = new Set();
      const volumeIds = new Set();

      for (const p of products) {
        if (p.mainCategoryId) mainCategoryIds.add(p.mainCategoryId);
        if (p.subCategoryId) subCategoryIds.add(p.subCategoryId);
        if (p.companyCategoryId)
          companyCategoryIds.add(p.companyCategoryId);
      }

      for (const v of variants) {
        if (v.volumeId) volumeIds.add(v.volumeId);
        if (v.baseUnitLabel) volumeIds.add(v.baseUnitLabel);
        if (v.innerUnitLabel) volumeIds.add(v.innerUnitLabel);
      }

      // Main Categories
      for (const id of mainCategoryIds) {
        const exists = await MainCategory.findByPk(id, {
          transaction: t,
          paranoid: false
        });

        if (!exists) {
          await MainCategory.create(
            {
              id,
              title: { en: `Main Category ${id}` },
              image: '',
              status: 'Active'
            },
            { transaction: t }
          );

          console.log(
            `[Seed] Created default MainCategory: ${id}`
          );
        }
      }

      // Sub Categories
      for (const id of subCategoryIds) {
        const exists = await SubCategory.findByPk(id, {
          transaction: t,
          paranoid: false
        });

        if (!exists) {
          const productWithSub = products.find(
            p => p.subCategoryId === id
          );

          const mId = productWithSub
            ? productWithSub.mainCategoryId
            : [...mainCategoryIds][0];

          await SubCategory.create(
            {
              id,
              mainCategoryId: mId,
              title: { en: `Sub Category ${id}` },
              image: '',
              status: 'Active'
            },
            { transaction: t }
          );

          console.log(
            `[Seed] Created default SubCategory: ${id}`
          );
        }
      }

      // Company Categories
      for (const id of companyCategoryIds) {
        const exists = await CompanyCategory.findByPk(id, {
          transaction: t,
          paranoid: false
        });

        if (!exists) {
          await CompanyCategory.create(
            {
              id,
              title: { en: `Company Category ${id}` },
              image: '',
              status: 'Active'
            },
            { transaction: t }
          );

          console.log(
            `[Seed] Created default CompanyCategory: ${id}`
          );
        }
      }

      // Volumes
      for (const id of volumeIds) {
        const exists = await Volume.findByPk(id, {
          transaction: t,
          paranoid: false
        });

        if (!exists) {
          await Volume.create(
            {
              id,
              name: { en: `Volume ${id}` },
              status: 'Active'
            },
            { transaction: t }
          );

          console.log(`[Seed] Created default Volume: ${id}`);
        }
      }

      // Custom Levels
      for (const level of customLevelsData) {
        const exists = await CustomLevel.findByPk(level.id, {
          transaction: t,
          paranoid: false
        });

        if (!exists) {
          await CustomLevel.create(
            {
              id: level.id,
              name: level.name,
              status: level.status
            },
            { transaction: t }
          );

          console.log(
            `[Seed] Created CustomLevel: ${level.name}`
          );
        }
      }

      // Products
      console.log('[Seed] Seeding Products...');

      const productFields = Object.keys(Product.rawAttributes);

      await Product.bulkCreate(products, {
        updateOnDuplicate: productFields,
        transaction: t
      });

      // Variants
      console.log('[Seed] Seeding Product Variants...');

      const variantFields = Object.keys(
        ProductVariant.rawAttributes
      );

      await ProductVariant.bulkCreate(variants, {
        updateOnDuplicate: variantFields,
        transaction: t
      });

      // Pricings
      console.log('[Seed] Seeding Product Pricings...');

      const pricingFields = Object.keys(
        ProductPricing.rawAttributes
      );

      await ProductPricing.bulkCreate(pricings, {
        updateOnDuplicate: pricingFields,
        transaction: t
      });

      await t.commit();

      console.log(
        '[Seed] All products, variants, and pricings imported successfully ✓'
      );

      process.exit(0);
    } catch (error) {
      await t.rollback();
      throw error;
    }
  } catch (error) {
    console.error(
      '[Seed Error] Failed to seed from static data:',
      error
    );

    process.exit(1);
  }
}

seed();