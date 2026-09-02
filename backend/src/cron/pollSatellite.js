import cron from 'node-cron';
import Field from '../models/Field.js';
import { fetchNdviForFarm } from '../services/ndviService.js';
import { computeThermalReading } from '../services/thermalService.js';
import WeatherReading from '../models/WeatherReading.js';

const BATCH_SIZE = parseInt(process.env.CRON_BATCH_SIZE || '200', 10);

/**
 * Poll satellite NDVI + Landsat thermal for active farms daily.
 *
 * Sentinel-2 revisit is ~5 days, Landsat ~16 days.
 * Real satellite data is used when Copernicus credentials are configured;
 * simulated fallback otherwise.
 *
 * Farms needing tightened monitoring (active cases) are prioritized.
 */
async function pollSatelliteForActiveFarms() {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const farms = await Field.find({
    status: 'active',
    deletedAt: null,
    $or: [
      { lastRiskScoreAt: null },
      { lastRiskScoreAt: { $lt: oneDayAgo } },
    ],
  })
    .sort({ lastRiskScoreAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  if (farms.length === 0) {
    console.log('⏱️  [poll-satellite] No farms need satellite polling');
    return { polled: 0, errors: 0 };
  }

  console.log(`🛰️  [poll-satellite] Polling ${farms.length} farms...`);

  let polled = 0;
  let errors = 0;

  for (const farm of farms) {
    try {
      // Fetch NDVI from Sentinel-2 (or simulated)
      await fetchNdviForFarm(farm);

      // Fetch thermal from Landsat (or formula fallback)
      try {
        const latestWeather = await WeatherReading.findOne({ farmId: farm._id })
          .sort({ observedAt: -1 })
          .lean();
        if (latestWeather) {
          await computeThermalReading(farm, latestWeather);
        }
      } catch (thermalErr) {
        // Thermal fetch failure shouldn't block NDVI
        console.warn(`⚠️  [poll-satellite] Farm ${farm._id} thermal: ${thermalErr.message}`);
      }

      polled++;
    } catch (err) {
      console.error(`❌ [poll-satellite] Farm ${farm._id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`✅ [poll-satellite] Done: ${polled} polled, ${errors} errors`);
  return { polled, errors };
}

/**
 * Schedule: daily at 06:00 UTC (11:30 AM IST — after overnight Sentinel-2 passes).
 * Cron: 0 6 * * *
 */
export function startPollSatelliteCron() {
  cron.schedule('0 6 * * *', async () => {
    console.log('⏰ [cron] poll-satellite triggered');
    try {
      await pollSatelliteForActiveFarms();
    } catch (err) {
      console.error('❌ [cron] poll-satellite crashed:', err.message);
    }
  });

  console.log('📅 [cron] poll-satellite scheduled: daily at 06:00 UTC');
}

// Allow manual trigger for testing
export { pollSatelliteForActiveFarms };
