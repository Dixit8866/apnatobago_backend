import express from 'express';
import authRoutes from './auth.routes.js';
import languageRoutes from './language.routes.js';
import mainCategoryRoutes from './mainCategory.routes.js';
import subCategoryRoutes from './subCategory.routes.js';
import companyCategoryRoutes from './companyCategory.routes.js';
import volumeRoutes from './volume.routes.js';
import sellingVolumeRoutes from './sellingVolume.routes.js';
import staffRoutes from './staff.routes.js';
import uploadRoutes from './upload.routes.js';
import godownRoutes from './godown.routes.js';
import godownStaffRoutes from './godownStaff.routes.js';
import customLevelRoutes from './customLevel.routes.js';
import productRoutes from './product.routes.js';
import inventoryRoutes from './inventory.routes.js';

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/languages', languageRoutes);
router.use('/main-categories', mainCategoryRoutes);
router.use('/sub-categories', subCategoryRoutes);
router.use('/company-categories', companyCategoryRoutes);
router.use('/volumes', volumeRoutes);
router.use('/selling-volumes', sellingVolumeRoutes);
router.use('/staff', staffRoutes);
router.use('/upload', uploadRoutes);
router.use('/godowns', godownRoutes);
router.use('/godown-staffs', godownStaffRoutes);
router.use('/custom-levels', customLevelRoutes);
router.use('/products', productRoutes);
router.use('/inventory', inventoryRoutes);

export default router;
