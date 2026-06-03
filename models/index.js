/**
 * Central Model Registry
 * Import all models here so associations are registered before sequelize.sync()
 */

import Admin from './superadmin-models/Admin.js';
import DeliveryBoy from './superadmin-models/DeliveryBoy.js';
import OrderAssignment from './superadmin-models/OrderAssignment.js';
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
import Notification from './superadmin-models/Notification.js';
import AdminNotification from './superadmin-models/AdminNotification.js';
import BusinessProfile from './user/BusinessProfile.js';
import HelpSupport from './user/HelpSupport.js';
import OrderPayment from './user/OrderPayment.js';
import SalesReturn from './superadmin-models/SalesReturn.js';

// ─── Associations ───────────────────────────────────────────────────────────
// Order -> OrderPayment
Order.hasMany(OrderPayment, { foreignKey: 'orderId', as: 'payments' });
OrderPayment.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

// DeliveryBoy -> OrderPayment
DeliveryBoy.hasMany(OrderPayment, { foreignKey: 'deliveryBoyId', as: 'collectedPayments' });
OrderPayment.belongsTo(DeliveryBoy, { foreignKey: 'deliveryBoyId', as: 'deliveryBoy' });
// User -> HelpSupport (One User can have many help requests)
User.hasMany(HelpSupport, { foreignKey: 'userId', as: 'helpRequests' });
HelpSupport.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User -> BusinessProfile (One-to-One)
User.hasOne(BusinessProfile, { foreignKey: 'userId', as: 'businessProfile' });
BusinessProfile.belongsTo(User, { foreignKey: 'userId', as: 'user' });

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

// Banner -> Categories
MainCategory.hasMany(Banner, { foreignKey: 'mainCategoryId', as: 'banners' });
Banner.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

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

// Order Assignment Associations
Order.hasOne(OrderAssignment, { foreignKey: 'orderId', as: 'assignment' });
OrderAssignment.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

DeliveryBoy.hasMany(OrderAssignment, { foreignKey: 'deliveryBoyId', as: 'assignments' });
OrderAssignment.belongsTo(DeliveryBoy, { foreignKey: 'deliveryBoyId', as: 'deliveryBoy' });

Product.belongsTo(Product, { foreignKey: 'comboProduct1Id', as: 'comboProduct1' });
Product.belongsTo(Product, { foreignKey: 'comboProduct2Id', as: 'comboProduct2' });

// Sales Return Associations
Order.hasMany(SalesReturn, { foreignKey: 'orderId', as: 'returns' });
SalesReturn.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

User.hasMany(SalesReturn, { foreignKey: 'userId', as: 'returns' });
SalesReturn.belongsTo(User, { foreignKey: 'userId', as: 'user' });

DeliveryBoy.hasMany(SalesReturn, { foreignKey: 'deliveryBoyId', as: 'returns' });
SalesReturn.belongsTo(DeliveryBoy, { foreignKey: 'deliveryBoyId', as: 'deliveryBoy' });

Product.hasMany(SalesReturn, { foreignKey: 'productId', as: 'returns' });
SalesReturn.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

ProductVariant.hasMany(SalesReturn, { foreignKey: 'variantId', as: 'returns' });
SalesReturn.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

// ─── Manual Migrations (Production Safe) ───────────────────────────────────
// These ensure that new columns are added if they don't exist yet
import sequelize from '../config/db.js';

const runManualMigrations = async () => {
    try {
        // Ensure cancellation statuses exist in enum_orders_orderStatus enum type
        try {
            await sequelize.query('ALTER TYPE "enum_orders_orderStatus" ADD VALUE IF NOT EXISTS \'Payment Verify\'');
            await sequelize.query('ALTER TYPE "enum_orders_orderStatus" ADD VALUE IF NOT EXISTS \'Admin Cancel\'');
            await sequelize.query('ALTER TYPE "enum_orders_orderStatus" ADD VALUE IF NOT EXISTS \'User Cancel\'');
            await sequelize.query('ALTER TYPE "enum_orders_orderStatus" ADD VALUE IF NOT EXISTS \'Delivery Boy Cancel\'');
        } catch (e) {
            console.log('[Migration Warning] enum_orders_orderStatus type alter failed or value already exists:', e.message);
        }

        // Ensure SALES_RETURN exists in enum_inventory_transactions_type enum type
        try {
            await sequelize.query('ALTER TYPE "enum_inventory_transactions_type" ADD VALUE IF NOT EXISTS \'SALES_RETURN\'');
        } catch (e) {
            console.log('[Migration Warning] enum_inventory_transactions_type type alter failed or value already exists:', e.message);
        }

        await sequelize.query('ALTER TABLE main_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
        await sequelize.query('ALTER TABLE sub_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
        await sequelize.query('ALTER TABLE company_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
        
        // Add blockcredit to users table if missing
        await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "blockcredit" BOOLEAN DEFAULT false');

        // Drop NOT NULL constraints from email and password
        await sequelize.query('ALTER TABLE users ALTER COLUMN "email" DROP NOT NULL');
        await sequelize.query('ALTER TABLE users ALTER COLUMN "password" DROP NOT NULL');
        
        // Fix deliveryBoyId in order_payments (ensure column exists and has correct constraint)
        await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "deliveryBoyId" UUID');
        await sequelize.query('ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS "order_payments_deliveryBoyId_fkey" CASCADE');
        await sequelize.query('ALTER TABLE order_payments ADD CONSTRAINT "order_payments_deliveryBoyId_fkey" FOREIGN KEY ("deliveryBoyId") REFERENCES delivery_boys(id) ON UPDATE CASCADE ON DELETE SET NULL');
        
        // Add isSubmitted and submittedAt to order_payments
        await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "isSubmitted" BOOLEAN DEFAULT false');
        await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE');
        
        // Add latitude and longitude to users table
        await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(15, 10)');
        
        // Add deviceType and version to users table
        await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "deviceType" VARCHAR(255)');
        await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "version" VARCHAR(255)');
        
        // Add minQty and maxQty to product_variants
        await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "minQty" DECIMAL(10, 2)');
        await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "maxQty" DECIMAL(10, 2)');
        
        // Add extra to product_variants
        await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "extra" VARCHAR(255)');

        // Add position to product_variants
        await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "position" INTEGER DEFAULT 0');
        
        // Add isCombo, comboProduct1Id, comboProduct2Id to products
        await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "isCombo" BOOLEAN DEFAULT false');
        await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "comboProduct1Id" UUID');
        await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "comboProduct2Id" UUID');

        // Add createdBy to inventory_transactions
        await sequelize.query('ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS "createdBy" VARCHAR(255) DEFAULT \'System\'');

        // Fix existing cancelled orders having positive dueAmount
        await sequelize.query('UPDATE orders SET "dueAmount" = 0 WHERE "orderStatus" = \'Cancelled\' AND "dueAmount" > 0');

        // Add mainCategoryId to banners
        await sequelize.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS "mainCategoryId" UUID REFERENCES main_categories(id) ON DELETE SET NULL');

        // Add timing and app settings fields to app_settings
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "supportPhoneNumber" VARCHAR(255)');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryAndroidVersion" VARCHAR(255) DEFAULT \'1.0.0\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryIosVersion" VARCHAR(255) DEFAULT \'1.0.0\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryForceUpdate" BOOLEAN DEFAULT false');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryRoundSchedules" JSONB DEFAULT \'[]\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "morningDeliveryStart" VARCHAR(255) DEFAULT \'08:00\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "morningDeliveryEnd" VARCHAR(255) DEFAULT \'13:00\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "eveningDeliveryStart" VARCHAR(255) DEFAULT \'15:00\'');
        await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "eveningDeliveryEnd" VARCHAR(255) DEFAULT \'17:00\'');

        console.log('[Migration] DB schema updates applied successfully ✓');
    } catch (error) {
        console.error('[Migration Error] Failed to update category tables:', error.message);
    }
};

// Run migrations (Non-blocking)
runManualMigrations();

export {
    Admin,
    DeliveryBoy,
    OrderAssignment,
    Notification,
    AdminNotification,
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
    BusinessProfile,
    HelpSupport,
    OrderPayment,
    SalesReturn,
    runManualMigrations
};
