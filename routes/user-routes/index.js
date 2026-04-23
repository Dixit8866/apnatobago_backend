import express from 'express';
import {
    registerUser,
    loginUser,
    sendOtp,
    verifyOtp,
    getProfile,
    logoutUser,
    deleteAccount,
    editProfile,
    forgotPassword,
    resetPassword,
    changePassword
} from '../../controllers/user/user.controller.js';
import {
    getMainCategories,
    getSubCategories,
    getCompanyCategories,
    getProducts,
    getProductsByMainCategory,
    getProductsBySubCategory,
    getProductsByCompanyCategory
} from '../../controllers/user/catalogue.controller.js';
import { protectUser } from '../../middlewares/userAuth.middleware.js';
import cartRoutes from './cart.routes.js';

const router = express.Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Profile and Account
router.get('/profile', protectUser, getProfile);
router.put('/profile', protectUser, editProfile);
router.post('/change-password', protectUser, changePassword);
router.post('/logout', protectUser, logoutUser);
router.delete('/delete-account', protectUser, deleteAccount);

// Catalogue - Protected by User Auth
router.get('/main-categories', protectUser, getMainCategories);
router.get('/sub-categories', protectUser, getSubCategories);
router.get('/company-categories', protectUser, getCompanyCategories);
router.get('/products', protectUser, getProducts);
router.get('/products/main-category/:id', protectUser, getProductsByMainCategory);
router.get('/products/sub-category/:id', protectUser, getProductsBySubCategory);
router.get('/products/company-category/:id', protectUser, getProductsByCompanyCategory);

// Cart
router.use('/cart', cartRoutes);

export default router;
