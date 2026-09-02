import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getRiskHistoryEndpoint,
  getRiskLatestEndpoint,
  getWeatherEndpoint,
  pollWeatherEndpoint,
  getNdviEndpoint,
  pollNdviEndpoint,
  getThermalEndpoint,
  pollThermalEndpoint,
} from '../controllers/monitoringController.js';

const router = express.Router();

// All monitoring routes require authentication
router.use(protect);

// Risk endpoints
router.get('/farms/:farmId/risk-history', getRiskHistoryEndpoint);
router.get('/farms/:farmId/risk-latest', getRiskLatestEndpoint);

// Weather endpoints
router.get('/farms/:farmId/weather', getWeatherEndpoint);
router.post('/farms/:farmId/poll-weather', pollWeatherEndpoint);

// NDVI endpoints
router.get('/farms/:farmId/ndvi', getNdviEndpoint);
router.post('/farms/:farmId/poll-ndvi', pollNdviEndpoint);

// Thermal endpoints
router.get('/farms/:farmId/thermal', getThermalEndpoint);
router.post('/farms/:farmId/poll-thermal', pollThermalEndpoint);

export default router;
