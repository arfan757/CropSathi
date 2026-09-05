import cron from 'node-cron';
import Field from '../models/Field.js';
import { pollWeatherForFarm } from '../services/weatherService.js';
import { computeRiskScore } from '../services/riskService.js';
import { fetchNdviForFarm } from '../services/ndviService.js';
import { computeThermalReading } from '../services/thermalService.js';
import WeatherReading from '../models/WeatherReading.js';

/**
 * Continuous polling for active fields - runs every 10 minutes.
 *
 * Ensures fresh data is available by:
 * 1. Polling weather if > 10 minutes old
 * 2. Fetching satellite data (NDVI/NDRE/Thermal) if > 6 hours old
 * 3. Recomputing health scores with fresh data
 *
 * This keeps the dashboard and analytics views always showing current data.
 */
async function pollActiveFarmsContinuously() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  // Find active farms that need updates
  const farms = await Field.find({
    status: 'active',
    deletedAt: null,
  })
    .sort({ lastWeatherPollAt: 1 })
    .limit(50) // Process up to 50 farms per cycle
    .lean();

  if (farms.length === 0) {
    return { polled: 0, weatherUpdates: 0, satelliteUpdates: 0, errors: 0 };
  }

  let weatherUpdates = 0;
  let satelliteUpdates = 0;
  let errors = 0;

  for (const farm of farms) {
    try {
      let needsRiskRecalc = false;

      // 1. Update weather if stale (>10 minutes old)
      if (!farm.lastWeatherPollAt || farm.lastWeatherPollAt < tenMinutesAgo) {
        try {
          await pollWeatherForFarm(farm);
          weatherUpdates++;
          needsRiskRecalc = true;
        } catch (weatherErr) {
          console.warn(`⚠️  [continuous-poll] Weather failed for ${farm._id}: ${weatherErr.message}`);
        }
      }

      // 2. Update satellite data if stale (>6 hours old)
      if (!farm.lastRiskScoreAt || farm.lastRiskScoreAt < sixHoursAgo) {
        try {
          // Fetch fresh NDVI/NDRE from Sentinel-2
          await fetchNdviForFarm(farm);

          // Fetch fresh thermal from Landsat
          const latestWeather = await WeatherReading.findOne({ farmId: farm._id })
            .sort({ observedAt: -1 })
            .lean();

          if (latestWeather) {
            await computeThermalReading(farm, latestWeather);
          }

          satelliteUpdates++;
          needsRiskRecalc = true;
        } catch (satelliteErr) {
          console.warn(`⚠️  [continuous-poll] Satellite failed for ${farm._id}: ${satelliteErr.message}`);
        }
      }

      // 3. Recompute health score if any data was updated
      if (needsRiskRecalc) {
        try {
          await computeRiskScore(farm._id);
        } catch (riskErr) {
          console.warn(`⚠️  [continuous-poll] Risk score failed for ${farm._id}: ${riskErr.message}`);
        }
      }
    } catch (err) {
      console.error(`❌ [continuous-poll] Farm ${farm._id}: ${err.message}`);
      errors++;
    }
  }

  const polled = weatherUpdates + satelliteUpdates;
  if (polled > 0) {
    console.log(`🔄 [continuous-poll] Updated ${polled} farms (${weatherUpdates} weather, ${satelliteUpdates} satellite)`);
  }

  return { polled, weatherUpdates, satelliteUpdates, errors };
}

/**
 * Schedule: every 10 minutes (cron expression: every 10 minutes).
 */
export function startContinuousPollCron() {
  cron.schedule('*/10 * * * *', async () => {
    try {
      await pollActiveFarmsContinuously();
    } catch (err) {
      console.error('❌ [cron] continuous-poll crashed:', err.message);
    }
  });

  console.log('📅 [cron] continuous-poll scheduled: every 10 minutes');
}

// Allow manual trigger
export { pollActiveFarmsContinuously };
