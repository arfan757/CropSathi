import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getNdviGridEndpoint,
  getNdreGridEndpoint,
  getThermalGridEndpoint,
  getTimeseriesEndpoint,
  pollSatelliteEndpoint,
} from '../controllers/analyticsController.js';

const router = express.Router();

// All analytics routes require authentication
router.use(protect);

// Grid endpoints (for heatmap visualization)
router.get('/farms/:farmId/ndvi-grid', getNdviGridEndpoint);
router.get('/farms/:farmId/ndre-grid', getNdreGridEndpoint);
router.get('/farms/:farmId/thermal-grid', getThermalGridEndpoint);

// Timeseries endpoint (for trend charts)
router.get('/farms/:farmId/timeseries', getTimeseriesEndpoint);

// Satellite polling
router.post('/farms/:farmId/poll-satellite', pollSatelliteEndpoint);

export default router;
