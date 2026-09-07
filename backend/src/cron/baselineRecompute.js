import cron from 'node-cron';
import NdviReading from '../models/NdviReading.js';
import CropBaseline from '../models/CropBaseline.js';
import Field from '../models/Field.js';
import User from '../models/User.js';

const TRAILING_DAYS = 90;
const MIN_SAMPLE_SIZE = 30;
const NDVI_CLOUD_THRESHOLD_PCT = 40;

/**
 * Compute the p-th percentile of a sorted numeric array.
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Resolve the district for a field via its owner's User document.
 * Lowercased to match CropBaseline's lowercase region keys
 * (User districts are free-text, e.g. 'Pune').
 */
async function resolveDistrict(userId) {
  const user = await User.findById(userId).select('farmDetails.district').lean();
  return (user?.farmDetails?.district || 'global').toLowerCase();
}

/**
 * Compute NDVI/NDRE percentiles for a single cropType+region combination.
 */
async function computeBaselineForGroup(cropType, region, fieldIds, cutoff) {
  const readings = await NdviReading.find({
    farmId: { $in: fieldIds },
    sceneSource: 'sentinel-2',
    cloudCoverPct: { $lte: NDVI_CLOUD_THRESHOLD_PCT },
    observedAt: { $gte: cutoff },
    ndvi: { $ne: null },
  })
    .select('ndvi ndre observedAt')
    .lean();

  const ndviValues = readings.map(r => r.ndvi).filter(v => v != null);
  const ndreValues = readings.map(r => r.ndre).filter(v => v != null);

  if (ndviValues.length < MIN_SAMPLE_SIZE) {
    return { sampleSize: ndviValues.length, source: 'default' };
  }

  ndviValues.sort((a, b) => a - b);
  ndreValues.sort((a, b) => a - b);

  return {
    ndviP05: Math.round(percentile(ndviValues, 5) * 1000) / 1000,
    ndviP95: Math.round(percentile(ndviValues, 95) * 1000) / 1000,
    ndreP05: ndreValues.length >= MIN_SAMPLE_SIZE
      ? Math.round(percentile(ndreValues, 5) * 1000) / 1000
      : -0.1,
    ndreP95: ndreValues.length >= MIN_SAMPLE_SIZE
      ? Math.round(percentile(ndreValues, 95) * 1000) / 1000
      : 0.7,
    sampleSize: ndviValues.length,
    source: 'calibrated',
  };
}

/**
 * Main recompute function. Runs weekly.
 */
async function recomputeBaselines() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - TRAILING_DAYS * 24 * 60 * 60 * 1000);

  // 1. Get all active fields with cropType set
  const fields = await Field.find({
    status: 'active',
    deletedAt: null,
    cropType: { $ne: null },
  })
    .select('_id userId cropType')
    .lean();

  if (fields.length === 0) {
    console.log('⏱️  [baseline-recompute] No active fields with cropType');
    return { groupsProcessed: 0, baselinesUpserted: 0 };
  }

  // 2. Group fields by (cropType, district)
  // Both keys lowercased: Field.cropType enum is capitalized ('Cotton')
  // while CropBaseline stores lowercase keys.
  const groups = {};
  for (const field of fields) {
    const district = await resolveDistrict(field.userId);
    const cropKey = (field.cropType || '').toLowerCase();
    const key = `${cropKey}::${district}`;
    if (!groups[key]) {
      groups[key] = { cropType: cropKey, region: district, fieldIds: [] };
    }
    groups[key].fieldIds.push(field._id);
  }

  console.log(`📊 [baseline-recompute] Processing ${Object.keys(groups).length} crop+region groups`);

  let baselinesUpserted = 0;

  // 3. For each group, compute percentiles and upsert CropBaseline
  for (const group of Object.values(groups)) {
    try {
      const result = await computeBaselineForGroup(
        group.cropType,
        group.region,
        group.fieldIds,
        cutoff,
      );

      if (result.source === 'default') {
        console.log(
          `  ⏭️  ${group.cropType}/${group.region}: ` +
          `insufficient data (${result.sampleSize} samples < ${MIN_SAMPLE_SIZE})`
        );
        continue;
      }

      await CropBaseline.findOneAndUpdate(
        { cropType: group.cropType, region: group.region },
        {
          ndviP05: result.ndviP05,
          ndviP95: result.ndviP95,
          ndreP05: result.ndreP05,
          ndreP95: result.ndreP95,
          sampleSize: result.sampleSize,
          lastRecomputedAt: now,
          source: 'calibrated',
        },
        { upsert: true, new: true },
      );

      baselinesUpserted++;
      console.log(
        `  ✅ ${group.cropType}/${group.region}: ` +
        `n=${result.sampleSize}, NDVI=[${result.ndviP05}, ${result.ndviP95}], ` +
        `NDRE=[${result.ndreP05}, ${result.ndreP95}]`
      );
    } catch (err) {
      console.error(`  ❌ ${group.cropType}/${group.region}: ${err.message}`);
    }
  }

  console.log(
    `📊 [baseline-recompute] Done: ${baselinesUpserted} baselines upserted ` +
    `from ${Object.keys(groups).length} groups`
  );

  return { groupsProcessed: Object.keys(groups).length, baselinesUpserted };
}

/**
 * Start the weekly baseline recompute cron.
 * Runs every Sunday at 02:00 UTC.
 */
export function startBaselineRecomputeCron() {
  cron.schedule('0 2 * * 0', async () => {
    console.log('⏰ [cron] baseline-recompute triggered');
    try {
      await recomputeBaselines();
    } catch (err) {
      console.error('❌ [cron] baseline-recompute crashed:', err.message);
    }
  });

  console.log('📅 [cron] baseline-recompute scheduled: Sunday 02:00 UTC');
}

export { recomputeBaselines };
