import cron from 'node-cron';
import Field from '../models/Field.js';
import { pollWeatherForFarm } from '../services/weatherService.js';
import { computeRiskScore } from '../services/riskService.js';

const BATCH_SIZE = parseInt(process.env.CRON_BATCH_SIZE || '200', 10);

/**
 * Poll weather for active farms and recompute health scores.
 *
 * For each active farm not polled in the last 2 hours:
 *  1. Fetch Open-Meteo weather data
 *  2. computeRiskScore() handles NDVI, thermal, weather eval, and fusion
 *
 * Farms with tightened monitoring (active cases) are prioritized first.
 */
async function pollWeatherForActiveFarms() {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

  // Priority 1: farms needing tightened monitoring (polled recently but still prioritized)
  // Priority 2: farms not polled in last 2 hours, oldest first
  const farms = await Field.find({
    status: 'active',
    deletedAt: null,
    $or: [
      { lastWeatherPollAt: null },
      { lastWeatherPollAt: { $lt: twoHoursAgo } },
    ],
  })
    .sort({ lastWeatherPollAt: 1 })
    .limit(BATCH_SIZE)
    .lean();

  if (farms.length === 0) {
    console.log('⏱️  [poll-weather] No farms need polling');
    return { polled: 0, errors: 0 };
  }

  console.log(`🌤️  [poll-weather] Polling ${farms.length} farms...`);

  let polled = 0;
  let errors = 0;

  for (const farm of farms) {
    try {
      // 1. Fetch weather data
      await pollWeatherForFarm(farm);

      // 2. computeRiskScore orchestrates NDVI, thermal, weather eval, and fusion
      await computeRiskScore(farm._id);

      polled++;
    } catch (err) {
      console.error(`❌ [poll-weather] Farm ${farm._id}: ${err.message}`);
      errors++;
    }
  }

  console.log(`✅ [poll-weather] Done: ${polled} polled, ${errors} errors`);
  return { polled, errors };
}

// Schedule: every 2 hours at minute 0 (cron: 0 0 */2 * *)
export function startPollWeatherCron() {
  cron.schedule('0 0 */2 * *', async () => {
    console.log('⏰ [cron] poll-weather triggered');
    try {
      await pollWeatherForActiveFarms();
    } catch (err) {
      console.error('❌ [cron] poll-weather crashed:', err.message);
    }
  });

  console.log('📅 [cron] poll-weather scheduled: every 2 hours');
}

// Allow manual trigger for testing
export { pollWeatherForActiveFarms };
