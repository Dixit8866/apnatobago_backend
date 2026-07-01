import sequelize from '../config/db.js';
import { Product, ProductVariant, Volume } from '../models/index.js';

async function check() {
  try {
    const products = await Product.findAll({
      attributes: { exclude: ['createdAt', 'updatedAt', 'deletedAt'] },
      include: [
        {
          model: ProductVariant,
          as: 'variants',
          attributes: {
              exclude: ['purchasePrice', 'productId', 'createdAt', 'updatedAt', 'deletedAt'],
              include: [
                  [
                      sequelize.literal(`(
                          SELECT COALESCE(SUM("stock"."totalBaseUnits"), 0)
                          FROM "inventory_stocks" AS "stock"
                          WHERE "stock"."variantId" = "variants"."id"
                            AND "stock"."status" = 'Active'
                            AND "stock"."deletedAt" IS NULL
                      )`),
                      'totalStock'
                  ]
              ]
          },
          include: [
              { model: Volume, as: 'volumeRef', attributes: ['id', 'name'] },
              { model: Volume, as: 'baseUnitRef', attributes: ['id', 'name'] },
              { model: Volume, as: 'innerUnitRef', attributes: ['id', 'name'] }
          ]
        }
      ]
    });

    for (const p of products) {
      const name = typeof p.name === 'object' ? JSON.stringify(p.name) : p.name;
      if (name.includes('માચીસ') || name.includes('Machis')) {
        console.log(`Product: ID=${p.id}, Name=${JSON.stringify(p.name)}`);
        console.log(`Number of variants in variants array: ${p.variants.length}`);
        const ids = p.variants.map(v => v.id);
        console.log(`Variant IDs in array:`, ids);
        
        // Find if there are duplicates
        const uniqueIds = new Set(ids);
        if (uniqueIds.size !== ids.length) {
          console.log(`WARNING: Duplicate variant IDs found in the variants array!`);
        } else {
          console.log(`No duplicate variant IDs in the array.`);
        }
      }
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

check();
