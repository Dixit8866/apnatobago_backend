/**
 * Central Model Registry
 * Import all models here so associations are registered before sequelize.sync()
 */

import Admin from './superadmin-models/Admin.js';
import Godown from './superadmin-models/Godown.js';
import GodownStaff from './superadmin-models/GodownStaff.js';
import Language from './superadmin-models/Language.js';
import MainCategory from './superadmin-models/MainCategory.js';
import SubCategory from './superadmin-models/SubCategory.js';
import CompanyCategory from './superadmin-models/CompanyCategory.js';
import Volume from './superadmin-models/Volume.js';
import SellingVolume from './superadmin-models/SellingVolume.js';
import CustomLevel from './superadmin-models/CustomLevel.js';
import Product from './superadmin-models/Product.js';
import ProductVariant from './superadmin-models/ProductVariant.js';
import ProductPricing from './superadmin-models/ProductPricing.js';
import InventoryStock from './superadmin-models/InventoryStock.js';
import InventoryTransaction from './superadmin-models/InventoryTransaction.js';
import User from './user/User.js';
import OTP from './user/Otp.js';

// ─── Associations ───────────────────────────────────────────────────────────
// Godown -> GodownStaff (One Godown has many Staff members)
Godown.hasMany(GodownStaff, { foreignKey: 'godownId', as: 'staffs' });
GodownStaff.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

// Product -> Variants (volume-wise)
Product.hasMany(ProductVariant, { foreignKey: 'productId', as: 'variants' });
ProductVariant.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Variant -> Pricings (level + quantity)
ProductVariant.hasMany(ProductPricing, { foreignKey: 'variantId', as: 'pricings' });
ProductPricing.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

// Variant -> Volume (so edit form can get volumeId directly)
Volume.hasMany(ProductVariant, { foreignKey: 'volumeId', as: 'productVariants' });
ProductVariant.belongsTo(Volume, { foreignKey: 'volumeId', as: 'volumeRef' });

// Pricing -> CustomLevel
CustomLevel.hasMany(ProductPricing, { foreignKey: 'customLevelId', as: 'productPricings' });
ProductPricing.belongsTo(CustomLevel, { foreignKey: 'customLevelId', as: 'customLevel' });

// Product -> Categories
MainCategory.hasMany(Product, { foreignKey: 'mainCategoryId', as: 'products' });
Product.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

SubCategory.hasMany(Product, { foreignKey: 'subCategoryId', as: 'products' });
Product.belongsTo(SubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

CompanyCategory.hasMany(Product, { foreignKey: 'companyCategoryId', as: 'products' });
Product.belongsTo(CompanyCategory, { foreignKey: 'companyCategoryId', as: 'companyCategory' });

// CompanyCategory -> Main/Sub Category associations
MainCategory.hasMany(CompanyCategory, { foreignKey: 'mainCategoryId', as: 'companyCategories' });
CompanyCategory.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

SubCategory.hasMany(CompanyCategory, { foreignKey: 'subCategoryId', as: 'companyCategories' });
CompanyCategory.belongsTo(SubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

// Inventory stock (per product + variant)
Product.hasMany(InventoryStock, { foreignKey: 'productId', as: 'inventoryStocks' });
InventoryStock.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(InventoryStock, { foreignKey: 'variantId', as: 'inventoryStocks' });
InventoryStock.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

Godown.hasMany(InventoryStock, { foreignKey: 'godownId', as: 'inventoryStocks' });
InventoryStock.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

// Inventory transactions
InventoryStock.hasMany(InventoryTransaction, { foreignKey: 'stockId', as: 'transactions' });
InventoryTransaction.belongsTo(InventoryStock, { foreignKey: 'stockId', as: 'stock' });

Product.hasMany(InventoryTransaction, { foreignKey: 'productId', as: 'inventoryTransactions' });
InventoryTransaction.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(InventoryTransaction, { foreignKey: 'variantId', as: 'inventoryTransactions' });
InventoryTransaction.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

Godown.hasMany(InventoryTransaction, { foreignKey: 'godownId', as: 'inventoryTransactions' });
InventoryTransaction.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

export {
    Admin,
    Godown,
    GodownStaff,
    Language,
    MainCategory,
    SubCategory,
    CompanyCategory,
    Volume,
    SellingVolume,
    CustomLevel,
    Product,
    ProductVariant,
    ProductPricing,
    InventoryStock,
    InventoryTransaction,
    User,
    OTP
};
