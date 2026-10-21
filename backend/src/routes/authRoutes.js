import express from 'express';
import { register, login, getMe, updateLocation, changePassword, updateProfile } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/update-location', protect, updateLocation);
router.put('/change-password', protect, changePassword);
router.put('/update-profile', protect, updateProfile); // This now handles both name and photo

export default router;