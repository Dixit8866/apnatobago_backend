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
import CustomLevel from './superadmin-models/CustomLevel.js';
import Product from './superadmin-models/Product.js';
import ProductVariant from './superadmin-models/ProductVariant.js';
import ProductPricing from './superadmin-models/ProductPricing.js';
import InventoryStock from './superadmin-models/InventoryStock.js';
import InventoryTransaction from './superadmin-models/InventoryTransaction.js';
import User from './user/User.js';
import OTP from './user/Otp.js';
import Vendor from './superadmin-models/Vendor.js';
import VendorOrder from './superadmin-models/VendorOrder.js';
import PurchaseBill from './superadmin-models/PurchaseBill.js';
import Cart from './user/Cart.js';
import Wishlist from './user/Wishlist.js';
import AppSettings from './superadmin-models/AppSettings.js';
import Banner from './superadmin-models/Banner.js';
import Order from './user/Order.js';
import OrderItem from './user/OrderItem.js';

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

// Variant -> BaseUnit (for mapping volume UUID back to name)
Volume.hasMany(ProductVariant, { foreignKey: 'baseUnitLabel', as: 'productBaseVariants' });
ProductVariant.belongsTo(Volume, { foreignKey: 'baseUnitLabel', as: 'baseUnitRef' });

// Variant -> InnerUnit (Selling Unit)
Volume.hasMany(ProductVariant, { foreignKey: 'innerUnitLabel', as: 'productInnerVariants' });
ProductVariant.belongsTo(Volume, { foreignKey: 'innerUnitLabel', as: 'innerUnitRef' });

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

// Vendor -> VendorOrder
Vendor.hasMany(VendorOrder, { foreignKey: 'vendorId', as: 'orders' });
VendorOrder.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });

// User -> CustomLevel
CustomLevel.hasMany(User, { foreignKey: 'applevel', as: 'users' });
User.belongsTo(CustomLevel, { foreignKey: 'applevel', as: 'rewardLevel' });

// PurchaseBill Associations
Vendor.hasMany(PurchaseBill, { foreignKey: 'vendorId', as: 'purchaseBills' });
PurchaseBill.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });

VendorOrder.hasOne(PurchaseBill, { foreignKey: 'vendorOrderId', as: 'bill' });
PurchaseBill.belongsTo(VendorOrder, { foreignKey: 'vendorOrderId', as: 'vendorOrder' });

Godown.hasMany(PurchaseBill, { foreignKey: 'godownId', as: 'purchaseBills' });
PurchaseBill.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

Admin.hasMany(PurchaseBill, { foreignKey: 'receivedBy', as: 'receivedBills' });
PurchaseBill.belongsTo(Admin, { foreignKey: 'receivedBy', as: 'receiver' });

// Cart Associations
User.hasMany(Cart, { foreignKey: 'userId', as: 'cartItems' });
Cart.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Product.hasMany(Cart, { foreignKey: 'productId', as: 'cartItems' });
Cart.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(Cart, { foreignKey: 'variantId', as: 'cartItems' });
Cart.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

// Wishlist Associations
User.hasMany(Wishlist, { foreignKey: 'userId', as: 'wishlistItems' });
Wishlist.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Product.hasMany(Wishlist, { foreignKey: 'productId', as: 'wishlistedBy' });
Wishlist.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Order Associations
User.hasMany(Order, { foreignKey: 'userId', as: 'orders' });
Order.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Order.hasMany(OrderItem, { foreignKey: 'orderId', as: 'items' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

Product.hasMany(OrderItem, { foreignKey: 'productId', as: 'orderItems' });
OrderItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(OrderItem, { foreignKey: 'variantId', as: 'orderItems' });
OrderItem.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

export {
    Admin,
    Godown,
    GodownStaff,
    Language,
    MainCategory,
    SubCategory,
    CompanyCategory,
    Volume,
    CustomLevel,
    Product,
    ProductVariant,
    ProductPricing,
    InventoryStock,
    InventoryTransaction,
    User,
    OTP,
    Vendor,
    VendorOrder,
    PurchaseBill,
    Cart,
    Wishlist,
    AppSettings,
    Banner,
    Order,
    OrderItem,
};
