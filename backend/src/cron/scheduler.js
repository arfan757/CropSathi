import { startPollWeatherCron, pollWeatherForActiveFarms } from './pollWeather.js';
import { startPollSatelliteCron, pollSatelliteForActiveFarms } from './pollSatellite.js';
import { startFollowupScanCron, scanPendingFollowUps } from './followupScan.js';
import { startRetrainTriggerCron, checkRetrainReady } from './retrainTrigger.js';
import { verifyCronSecret } from './middleware.js';

/**
 * Start all cron job schedulers.
 * Called once from server.js after DB connection.
 */
export function startCronJobs() {
  startPollWeatherCron();
  startPollSatelliteCron();
  startFollowupScanCron();
  startRetrainTriggerCron();
}

/**
 * Mount manual trigger routes on the Express app.
 *
 * POST /api/cron/poll-weather      — trigger weather polling now
 * POST /api/cron/poll-satellite    — trigger satellite polling now
 * POST /api/cron/followup-scan     — trigger follow-up scan now
 * POST /api/cron/retrain-trigger   — trigger retrain check now
 *
 * All require X-Cron-Secret header (or no secret configured in dev).
 */
export function mountCronRoutes(app) {
  app.post('/api/cron/poll-weather', verifyCronSecret, async (req, res) => {
    try {
      const result = await pollWeatherForActiveFarms();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/cron/poll-satellite', verifyCronSecret, async (req, res) => {
    try {
      const result = await pollSatelliteForActiveFarms();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/cron/followup-scan', verifyCronSecret, async (req, res) => {
    try {
      const result = await scanPendingFollowUps();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/cron/retrain-trigger', verifyCronSecret, async (req, res) => {
    try {
      const result = await checkRetrainReady();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
