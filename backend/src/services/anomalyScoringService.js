/**
 * Optional Anomaly-Based Spectral Scoring Service (Phase 6 Scaffolding)
 *
 * Compares current NDVI/NDRE values against a historical rolling distribution
 * for the same crop, district, and calendar week.
 *
 * Feature flag: FEATURE_ANOMALY_NDVI (default: false).
 * Enforces automatic fallback to fixed baseline when history is insufficient (< 10 samples).
 */

export const FEATURE_ANOMALY_NDVI = process.env.FEATURE_ANOMALY_NDVI === 'true';

const MIN_ANOMALY_SAMPLES = 10;

/**
 * Compute anomaly-based stress score against rolling historical cohort.
 *
 * @param {object} params
 * @param {number} params.currentValue Current NDVI or NDRE value
 * @param {string} params.cropType Crop type
 * @param {string} [params.district] District location
 * @param {number} [params.calendarWeek] 1-52
 * @param {Array<number>} [params.historicalValues=[]] Historical readings for this cohort
 * @returns {object} Anomaly score result or fallback indicator
 */
export function computeAnomalySubScore({
  currentValue,
  cropType,
  district = 'unknown',
  calendarWeek = null,
  historicalValues = [],
}) {
  if (!FEATURE_ANOMALY_NDVI) {
    return {
      usedAnomaly: false,
      reason: 'feature_flag_disabled',
      stress: null,
    };
  }

  if (!Array.isArray(historicalValues) || historicalValues.length < MIN_ANOMALY_SAMPLES) {
    return {
      usedAnomaly: false,
      reason: 'insufficient_historical_cohort',
      sampleCount: Array.isArray(historicalValues) ? historicalValues.length : 0,
      minRequired: MIN_ANOMALY_SAMPLES,
      stress: null,
    };
  }

  const validValues = historicalValues.filter(v => typeof v === 'number' && !isNaN(v));
  if (validValues.length < MIN_ANOMALY_SAMPLES) {
    return {
      usedAnomaly: false,
      reason: 'insufficient_valid_values',
      sampleCount: validValues.length,
      stress: null,
    };
  }

  const n = validValues.length;
  const mean = validValues.reduce((sum, v) => sum + v, 0) / n;
  const variance = validValues.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev < 0.001) {
    // Zero variance in cohort -> cannot compute reliable z-score
    return {
      usedAnomaly: false,
      reason: 'zero_cohort_variance',
      stress: null,
    };
  }

  const zScore = (currentValue - mean) / stdDev;

  // Z-Score mapping:
  // z >= 0: at or above cohort mean -> stress = 0
  // z = -1: 1 std dev below mean -> moderate stress (~0.33)
  // z = -2: 2 std dev below mean -> elevated stress (~0.67)
  // z <= -3: 3 std dev below mean -> max stress (1.0)
  let stress = 0;
  if (zScore < 0) {
    stress = Math.min(1.0, Math.max(0, -zScore / 3.0));
  }

  return {
    usedAnomaly: true,
    cohortMean: Math.round(mean * 1000) / 1000,
    cohortStdDev: Math.round(stdDev * 1000) / 1000,
    sampleCount: n,
    zScore: Math.round(zScore * 100) / 100,
    stress: Math.round(stress * 1000) / 1000,
  };
}
