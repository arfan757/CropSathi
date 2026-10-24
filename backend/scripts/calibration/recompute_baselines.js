/**
 * Baseline Recomputation Script (F-03, F-21)
 *
 * Derives per-crop, per-stage NDVI/NDRE min/max from stored empirical ground-truth
 * observations and outputs an updated calibrationVersion.
 *
 * Cron Entry (Disabled by default per F-03 Ground Rules):
 * --------------------------------------------------------
 * To schedule empirical recalibration monthly on the 1st of every month at 02:00 AM:
 * cron.schedule('0 2 1 * *', async () => {
 *   if (process.env.ENABLE_CALIBRATION_CRON === 'true') {
 *     console.log('Running scheduled empirical baseline recalibration...');
 *     await recomputeBaselinesFromObservations(...);
 *   }
 * });
 */

/**
 * Computes a specific percentile from a sorted array of numbers.
 * @param {number[]} sortedArr
 * @param {number} p (0 to 100)
 * @returns {number}
 */
function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const weight = idx - lower;
  return sortedArr[lower] * (1 - weight) + sortedArr[upper] * weight;
}

/**
 * Derive per-crop, per-stage empirical min/max baselines from healthy field observations.
 *
 * @param {Array<object>} observations Array of ground-truth observations
 * @param {object} [options]
 * @param {number} [options.minSampleSize=5] Minimum healthy observations required to calibrate a stage
 * @param {string} [options.versionPrefix='v1.1.0-empirical'] Version identifier prefix
 * @returns {object} Recomputed calibration package
 */
export function recomputeBaselinesFromObservations(observations, options = {}) {
  const minSampleSize = options.minSampleSize ?? 5;
  const versionPrefix = options.versionPrefix ?? 'v1.1.0-empirical';

  // Only calibrate against healthy crop observations to establish true vegetative vigor bounds
  const healthyObs = observations.filter(obs => {
    const outcome = (obs.observedOutcome || obs.outcome || '').toLowerCase();
    return outcome === 'healthy';
  });

  const grouped = {};

  for (const obs of healthyObs) {
    const crop = (obs.crop || '').toLowerCase().trim();
    const stage = (obs.stage || '').toLowerCase().trim();
    if (!crop || !stage) continue;

    const key = `${crop}:${stage}`;
    if (!grouped[key]) {
      grouped[key] = { crop, stage, ndviValues: [], ndreValues: [] };
    }

    if (obs.observedNdvi !== null && obs.observedNdvi !== undefined && !isNaN(obs.observedNdvi)) {
      grouped[key].ndviValues.push(Number(obs.observedNdvi));
    }
    if (obs.observedNdre !== null && obs.observedNdre !== undefined && !isNaN(obs.observedNdre)) {
      grouped[key].ndreValues.push(Number(obs.observedNdre));
    }
  }

  const calibratedBaselines = {};
  const skippedCategories = [];

  for (const [key, data] of Object.entries(grouped)) {
    const { crop, stage, ndviValues, ndreValues } = data;

    if (ndviValues.length < minSampleSize) {
      skippedCategories.push({
        crop,
        stage,
        reason: `Insufficient samples (${ndviValues.length} < ${minSampleSize})`,
      });
      continue;
    }

    ndviValues.sort((a, b) => a - b);
    ndreValues.sort((a, b) => a - b);

    // Use 5th and 95th percentiles to avoid single-pixel outliers / clouds
    const ndviMin = Math.max(-0.2, Math.round(percentile(ndviValues, 5) * 1000) / 1000);
    const ndviMax = Math.min(1.0, Math.max(ndviMin + 0.05, Math.round(percentile(ndviValues, 95) * 1000) / 1000));

    let ndreMin = -0.1;
    let ndreMax = 0.7;
    if (ndreValues.length >= minSampleSize) {
      ndreMin = Math.max(-0.2, Math.round(percentile(ndreValues, 5) * 1000) / 1000);
      ndreMax = Math.min(1.0, Math.max(ndreMin + 0.05, Math.round(percentile(ndreValues, 95) * 1000) / 1000));
    }

    if (!calibratedBaselines[crop]) {
      calibratedBaselines[crop] = {};
    }

    calibratedBaselines[crop][stage] = {
      sampleCount: ndviValues.length,
      ndvi: { min: ndviMin, max: ndviMax },
      ndre: { min: ndreMin, max: ndreMax },
    };
  }

  const newVersion = `${versionPrefix}-${new Date().toISOString().slice(0, 10)}`;

  return {
    calibrationVersion: newVersion,
    calibrationStatus: Object.keys(calibratedBaselines).length > 0 ? 'calibrated' : 'literature_seed',
    generatedAt: new Date().toISOString(),
    minSampleSizeUsed: minSampleSize,
    calibratedCropsCount: Object.keys(calibratedBaselines).length,
    calibratedBaselines,
    skippedCategories,
    cronConfig: {
      schedule: '0 2 1 * *',
      enabled: false,
      description: 'Disabled by default per F-03 audit protocol. Set ENABLE_CALIBRATION_CRON=true to enable monthly auto-tuning.',
    },
  };
}
