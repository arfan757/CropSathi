import { Router } from 'express';
import { getDashboardHealth } from '../controllers/dashboardController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// All dashboard routes require authentication
router.use(protect);

// GET /api/dashboard/health — per-field health scores
router.get('/health', getDashboardHealth);

export default router;
