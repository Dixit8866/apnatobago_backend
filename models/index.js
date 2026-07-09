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
import PartyCalling from './user/PartyCalling.js';
import Vendor from './superadmin-models/Vendor.js';
import VendorOrder from './superadmin-models/VendorOrder.js';
import PurchaseBill from './superadmin-models/PurchaseBill.js';
import Cart from './user/Cart.js';
import Wishlist from './user/Wishlist.js';
import AppSettings from './superadmin-models/AppSettings.js';
import Banner from './superadmin-models/Banner.js';
import Offer from './superadmin-models/Offer.js';
import Order from './user/Order.js';
import OrderItem from './user/OrderItem.js';
import Notification from './superadmin-models/Notification.js';
import AdminNotification from './superadmin-models/AdminNotification.js';
import BusinessProfile from './user/BusinessProfile.js';
import HelpSupport from './user/HelpSupport.js';
import OrderPayment from './user/OrderPayment.js';
import SalesReturn from './superadmin-models/SalesReturn.js';
import RouteCategory from './superadmin-models/RouteCategory.js';
import BankSetting from './superadmin-models/BankSetting.js';
import AdminRole from './superadmin-models/AdminRole.js';
import StockTransfer from './superadmin-models/StockTransfer.js';
import StockTransferItem from './superadmin-models/StockTransferItem.js';

// ─── Associations ───────────────────────────────────────────────────────────
// Order -> OrderPayment
Order.hasMany(OrderPayment, { foreignKey: 'orderId', as: 'payments' });
OrderPayment.belongsTo(Order, { foreignKey: 'orderId', as: 'order' });

// Order -> Admin (Created By Admin association)
Order.belongsTo(Admin, { foreignKey: 'createdByAdminId', as: 'creator' });
Admin.hasMany(Order, { foreignKey: 'createdByAdminId', as: 'createdOrders' });

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

// Godown -> User (Party assignment)
Godown.hasMany(User, { foreignKey: 'godownId', as: 'assignedParties' });
User.belongsTo(Godown, { foreignKey: 'godownId', as: 'assignedGodown' });

// Godown -> Order (Order routing)
Godown.hasMany(Order, { foreignKey: 'godownId', as: 'godownOrders' });
Order.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

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

// Banner -> Categories / Products
MainCategory.hasMany(Banner, { foreignKey: 'mainCategoryId', as: 'banners' });
Banner.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

SubCategory.hasMany(Banner, { foreignKey: 'subCategoryId', as: 'banners' });
Banner.belongsTo(SubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

Product.hasMany(Banner, { foreignKey: 'productId', as: 'banners' });
Banner.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

// Offer -> Categories / Products
MainCategory.hasMany(Offer, { foreignKey: 'mainCategoryId', as: 'offers' });
Offer.belongsTo(MainCategory, { foreignKey: 'mainCategoryId', as: 'mainCategory' });

SubCategory.hasMany(Offer, { foreignKey: 'subCategoryId', as: 'offers' });
Offer.belongsTo(SubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

Product.hasMany(Offer, { foreignKey: 'productId', as: 'offers' });
Offer.belongsTo(Product, { foreignKey: 'productId', as: 'product' });

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

// RouteCategory -> User
RouteCategory.hasMany(User, { foreignKey: 'routeCategoryId', as: 'users' });
User.belongsTo(RouteCategory, { foreignKey: 'routeCategoryId', as: 'routeCategory' });

// RouteCategory -> Order
RouteCategory.hasMany(Order, { foreignKey: 'routeCategoryId', as: 'orders' });
Order.belongsTo(RouteCategory, { foreignKey: 'routeCategoryId', as: 'routeCategory' });

// PurchaseBill Associations
Vendor.hasMany(PurchaseBill, { foreignKey: 'vendorId', as: 'purchaseBills' });
PurchaseBill.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });

VendorOrder.hasOne(PurchaseBill, { foreignKey: 'vendorOrderId', as: 'bill' });
PurchaseBill.belongsTo(VendorOrder, { foreignKey: 'vendorOrderId', as: 'vendorOrder' });

Godown.hasMany(PurchaseBill, { foreignKey: 'godownId', as: 'purchaseBills' });
PurchaseBill.belongsTo(Godown, { foreignKey: 'godownId', as: 'godown' });

Admin.hasMany(PurchaseBill, { foreignKey: 'receivedBy', as: 'receivedBills' });
PurchaseBill.belongsTo(Admin, { foreignKey: 'receivedBy', as: 'receiver' });

User.hasMany(Cart, { foreignKey: 'userId', as: 'cartItems' });
Cart.belongsTo(User, { foreignKey: 'userId', as: 'user' });

// User -> PartyCalling Associations
User.hasMany(PartyCalling, { foreignKey: 'userId', as: 'calls' });
PartyCalling.belongsTo(User, { foreignKey: 'userId', as: 'user' });

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

// BankSetting Associations
DeliveryBoy.hasMany(BankSetting, { foreignKey: 'deliveryBoyId', as: 'bankSettings' });
BankSetting.belongsTo(DeliveryBoy, { foreignKey: 'deliveryBoyId', as: 'deliveryBoy' });

// BankSetting -> OrderPayment Associations
BankSetting.hasMany(OrderPayment, { foreignKey: 'bankSettingId', as: 'payments' });
OrderPayment.belongsTo(BankSetting, { foreignKey: 'bankSettingId', as: 'bankAccount' });

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

        try {
            await sequelize.query('ALTER TABLE main_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE sub_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE company_categories ADD COLUMN IF NOT EXISTS "isTobacco" BOOLEAN DEFAULT false');
        } catch (e) { console.log('[Migration Warning] Category tables update failed:', e.message); }

        try {
            // Add blockcredit to users table if missing
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "blockcredit" BOOLEAN DEFAULT false');
        } catch (e) { console.log('[Migration Warning] Users blockcredit update failed:', e.message); }

        try {
            // Drop NOT NULL constraints from email and password
            await sequelize.query('ALTER TABLE users ALTER COLUMN "email" DROP NOT NULL');
            await sequelize.query('ALTER TABLE users ALTER COLUMN "password" DROP NOT NULL');
        } catch (e) { console.log('[Migration Warning] Users email/password nullable constraint failed:', e.message); }

        try {
            // Fix deliveryBoyId in order_payments (ensure column exists and has correct constraint)
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "deliveryBoyId" UUID');
            await sequelize.query('ALTER TABLE order_payments DROP CONSTRAINT IF EXISTS "order_payments_deliveryBoyId_fkey" CASCADE');
            await sequelize.query('ALTER TABLE order_payments ADD CONSTRAINT "order_payments_deliveryBoyId_fkey" FOREIGN KEY ("deliveryBoyId") REFERENCES delivery_boys(id) ON UPDATE CASCADE ON DELETE SET NULL');
        } catch (e) { console.log('[Migration Warning] Order payments constraint update failed:', e.message); }

        try {
            // Add isSubmitted and submittedAt to order_payments
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "isSubmitted" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP WITH TIME ZONE');
        } catch (e) { console.log('[Migration Warning] Order payments submitted fields failed:', e.message); }

        try {
            // Add latitude and longitude to users table
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "longitude" DECIMAL(15, 10)');
        } catch (e) { console.log('[Migration Warning] Users longitude column failed:', e.message); }

        try {
            // Add routeCategoryId to users table
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "routeCategoryId" UUID REFERENCES route_categories(id) ON DELETE SET NULL');
        } catch (e) { console.log('[Migration Warning] Users routeCategoryId column failed:', e.message); }

        try {
            // Add deliveryRoundId and deliveryRoundTiming to users table
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "deliveryRoundId" VARCHAR(255)');
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "deliveryRoundTiming" VARCHAR(255)');
        } catch (e) { console.log('[Migration Warning] Users delivery round/timing columns failed:', e.message); }

        try {
            // Create party_callings table manually if missing
            await sequelize.query(`
                CREATE TABLE IF NOT EXISTS party_callings (
                    id UUID PRIMARY KEY,
                    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
                    "callingDate" DATE NOT NULL,
                    status VARCHAR(255) DEFAULT 'Pending Call',
                    notes TEXT,
                    "calledAt" TIMESTAMP WITH TIME ZONE,
                    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
                    CONSTRAINT unique_user_date UNIQUE ("userId", "callingDate")
                )
            `);
            // Add followupDateTime column if missing
            await sequelize.query('ALTER TABLE party_callings ADD COLUMN IF NOT EXISTS "followupDateTime" TIMESTAMP WITH TIME ZONE');
        } catch (e) {
            console.log('[Migration Warning] party_callings table creation/update failed:', e.message);
        }

        try {
            // Add bankSettingId, screenshot, and onlineType to order_payments table
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "bankSettingId" UUID REFERENCES bank_settings(id) ON DELETE SET NULL ON UPDATE CASCADE');
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "screenshot" VARCHAR(255)');
            await sequelize.query('ALTER TABLE order_payments ADD COLUMN IF NOT EXISTS "onlineType" VARCHAR(255)');
        } catch (e) {
            console.log('[Migration Warning] order_payments columns migration failed:', e.message);
        }

        try {
            // Add routeCategoryId to orders table
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "routeCategoryId" UUID REFERENCES route_categories(id) ON DELETE SET NULL');
        } catch (e) { console.log('[Migration Warning] Orders routeCategoryId column failed:', e.message); }

        try {
            // Add isMerged to orders table
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "isMerged" BOOLEAN DEFAULT false');
        } catch (e) { console.log('[Migration Warning] Orders isMerged column failed:', e.message); }

        try {
            // Add deviceType and version to users table
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "deviceType" VARCHAR(255)');
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "version" VARCHAR(255)');
        } catch (e) { console.log('[Migration Warning] Users device info columns failed:', e.message); }

        try {
            // Update default reminderTime for new rows, and existing rows that don't match AM/PM format to '09:00 PM'
            await sequelize.query('ALTER TABLE users ALTER COLUMN "reminderTime" SET DEFAULT \'09:00 PM\'');
            await sequelize.query('UPDATE users SET "reminderTime" = \'09:00 PM\' WHERE "reminderTime" IS NOT NULL AND "reminderTime" NOT LIKE \'%AM\' AND "reminderTime" NOT LIKE \'%PM\'');
        } catch (e) { console.log('[Migration Warning] Users reminderTime migration failed:', e.message); }

        try {
            // Update all existing users to have orderReminder = true
            await sequelize.query('UPDATE users SET "orderReminder" = true WHERE "orderReminder" IS NOT TRUE');
        } catch (e) { console.log('[Migration Warning] Users orderReminder update failed:', e.message); }

        try {
            // Add minQty and maxQty to product_variants
            await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "minQty" DECIMAL(10, 2)');
            await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "maxQty" DECIMAL(10, 2)');
        } catch (e) { console.log('[Migration Warning] Product variants min/max qty columns failed:', e.message); }

        try {
            // Add extra to product_variants
            await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "extra" VARCHAR(255)');
        } catch (e) { console.log('[Migration Warning] Product variants extra column failed:', e.message); }

        try {
            // Add position to product_variants
            await sequelize.query('ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS "position" INTEGER DEFAULT 0');
        } catch (e) { console.log('[Migration Warning] Product variants position column failed:', e.message); }

        try {
            // Add isCombo, comboProduct1Id, comboProduct2Id to products
            await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "isCombo" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "comboProduct1Id" UUID');
            await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "comboProduct2Id" UUID');
        } catch (e) { console.log('[Migration Warning] Products combo columns failed:', e.message); }

        try {
            // Add keywords array to products table if missing
            await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "keywords" VARCHAR(255)[] DEFAULT \'{}\'');
        } catch (e) { console.log('[Migration Warning] Products keywords column failed:', e.message); }

        try {
            // Add createdBy to inventory_transactions
            await sequelize.query('ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS "createdBy" VARCHAR(255) DEFAULT \'System\'');
        } catch (e) { console.log('[Migration Warning] Inventory transaction createdBy column failed:', e.message); }

        try {
            // Fix existing cancelled orders having positive dueAmount
            await sequelize.query('UPDATE orders SET "dueAmount" = 0 WHERE "orderStatus" = \'Cancelled\' AND "dueAmount" > 0');
        } catch (e) { console.log('[Migration Warning] Order dueAmount update failed:', e.message); }

        try {
            // Add mainCategoryId to banners
            await sequelize.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS "mainCategoryId" UUID REFERENCES main_categories(id) ON DELETE SET NULL');
        } catch (e) { console.log('[Migration Warning] Banners mainCategoryId column failed:', e.message); }

        try {
            // Add subCategoryId and productId to banners
            await sequelize.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS "subCategoryId" UUID REFERENCES sub_categories(id) ON DELETE SET NULL');
            await sequelize.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS "productId" UUID REFERENCES products(id) ON DELETE SET NULL');
            await sequelize.query('ALTER TABLE banners ADD COLUMN IF NOT EXISTS "type" VARCHAR(255) DEFAULT \'Category\'');
        } catch (e) { console.log('[Migration Warning] Banners subCategoryId/productId/type columns failed:', e.message); }

        try {
            // Add image to help_supports
            await sequelize.query('ALTER TABLE help_supports ADD COLUMN IF NOT EXISTS "image" VARCHAR(255)');
        } catch (e) { console.log('[Migration Warning] Help supports image column failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "supportPhoneNumber" VARCHAR(255)');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "showExpressDelivery" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryAndroidVersion" VARCHAR(255) DEFAULT \'1.0.0\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryIosVersion" VARCHAR(255) DEFAULT \'1.0.0\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryForceUpdate" BOOLEAN DEFAULT false');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "deliveryRoundSchedules" JSONB DEFAULT \'[]\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "morningDeliveryStart" VARCHAR(255) DEFAULT \'08:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "morningDeliveryEnd" VARCHAR(255) DEFAULT \'13:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "eveningDeliveryStart" VARCHAR(255) DEFAULT \'15:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "eveningDeliveryEnd" VARCHAR(255) DEFAULT \'17:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "expressDeliveryStart" VARCHAR(255) DEFAULT \'08:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "expressDeliveryEnd" VARCHAR(255) DEFAULT \'18:00\'');
            await sequelize.query('ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS "expressDeliverySchedules" JSONB DEFAULT \'[]\'');
        } catch (e) { console.log('[Migration Warning] App settings columns failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryRoundId" VARCHAR(255)');
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveryRoundTiming" VARCHAR(255)');
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP WITH TIME ZONE');
        } catch (e) { console.log('[Migration Warning] Orders delivery timing/deliveredAt columns failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE bank_settings ADD COLUMN IF NOT EXISTS "accountNumber" VARCHAR(255)');
            await sequelize.query('ALTER TABLE bank_settings ADD COLUMN IF NOT EXISTS "ifscCode" VARCHAR(255)');
            await sequelize.query('ALTER TABLE bank_settings ADD COLUMN IF NOT EXISTS "deliveryBoyId" UUID REFERENCES delivery_boys(id) ON DELETE SET NULL');
            await sequelize.query('ALTER TABLE bank_settings ADD COLUMN IF NOT EXISTS "openingBalance" DECIMAL(15, 2) DEFAULT 0.00');
            await sequelize.query('ALTER TABLE bank_settings ADD COLUMN IF NOT EXISTS "branchName" VARCHAR(255)');
        } catch (e) { console.log('[Migration Warning] Bank settings columns failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS "boxNumber" VARCHAR(255) DEFAULT null');
        } catch (e) { console.log('[Migration Warning] Products boxNumber column failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE users ALTER COLUMN "fcmtoken" TYPE TEXT');
        } catch (e) { console.log('[Migration Warning] Alter users fcmtoken type failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE admins ADD COLUMN IF NOT EXISTS "fcmtoken" TEXT');
        } catch (e) { console.log('[Migration Warning] Add admins fcmtoken column failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "discount" DECIMAL(10, 2) DEFAULT 0');
        } catch (e) { console.log('[Migration Warning] Add orders discount column failed:', e.message); }

        try {
            await sequelize.query('ALTER TABLE order_items ADD COLUMN IF NOT EXISTS "discount" DECIMAL(10, 2) DEFAULT 0');
        } catch (e) { console.log('[Migration Warning] Add order_items discount column failed:', e.message); }

        try {
            // Add godownId to users table (party-godown assignment)
            await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS "godownId" UUID REFERENCES godowns(id) ON DELETE SET NULL ON UPDATE CASCADE');
        } catch (e) { console.log('[Migration Warning] Users godownId column failed:', e.message); }

        try {
            // Add godownId to orders table (order routing)
            await sequelize.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS "godownId" UUID REFERENCES godowns(id) ON DELETE SET NULL ON UPDATE CASCADE');
        } catch (e) { console.log('[Migration Warning] Orders godownId column failed:', e.message); }

        console.log('[Migration] DB schema updates applied successfully ✓');

    } catch (error) {
        console.error('[Migration Error] Failed to update category tables:', error.message);
    }
};

// StockTransfer associations
StockTransfer.belongsTo(Godown, { foreignKey: 'fromGodownId', as: 'fromGodown' });
StockTransfer.belongsTo(Godown, { foreignKey: 'toGodownId', as: 'toGodown' });
Godown.hasMany(StockTransfer, { foreignKey: 'fromGodownId', as: 'outgoingTransfers' });
Godown.hasMany(StockTransfer, { foreignKey: 'toGodownId', as: 'incomingTransfers' });

StockTransfer.hasMany(StockTransferItem, { foreignKey: 'stockTransferId', as: 'items' });
StockTransferItem.belongsTo(StockTransfer, { foreignKey: 'stockTransferId', as: 'transfer' });

StockTransferItem.belongsTo(Product, { foreignKey: 'productId', as: 'product' });
StockTransferItem.belongsTo(ProductVariant, { foreignKey: 'variantId', as: 'variant' });

// ─── Realtime Database Hooks ───────────────────────────────────────────────
import { emitAdminNotification } from '../socket.js';

const attachRealtimeHooks = (model, typeName) => {
    const handler = () => {
        try {
            emitAdminNotification({
                type: typeName,
                title: `${typeName} Changed`,
                message: `Realtime update for ${typeName}`
            });
        } catch (err) {
            console.error(`[Realtime Hook Error for ${typeName}]:`, err.message);
        }
    };

    model.addHook('afterCreate', handler);
    model.addHook('afterUpdate', handler);
    model.addHook('afterDestroy', handler);
    model.addHook('afterBulkCreate', handler);
    model.addHook('afterBulkUpdate', handler);
    model.addHook('afterBulkDestroy', handler);
};

// attachRealtimeHooks(Order, 'ORDER');
// attachRealtimeHooks(PurchaseBill, 'PURCHASE');
// attachRealtimeHooks(HelpSupport, 'HELP_SUPPORT');
// attachRealtimeHooks(InventoryStock, 'INVENTORY');
// attachRealtimeHooks(SalesReturn, 'SALES_RETURN');

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
    PartyCalling,
    Vendor,
    VendorOrder,
    PurchaseBill,
    Cart,
    Wishlist,
    AppSettings,
    Banner,
    Offer,
    Order,
    OrderItem,
    BusinessProfile,
    HelpSupport,
    OrderPayment,
    SalesReturn,
    RouteCategory,
    BankSetting,
    AdminRole,
    StockTransfer,
    StockTransferItem,
    runManualMigrations
};
