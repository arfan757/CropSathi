/**
 * vegetationHealth.js
 * ───────────────────
 * Computes a Field Health Score (0–100) using ONLY vegetation and thermal
 * signals: NDVI + NDRE (Sentinel-2) and CWSI (Landsat 8/9 thermal).
 *
 * This replaces the old 5-signal weighted fusion (weather + ndvi + ndre +
 * thermal + pestHistory) with a properly-normalized, properly-weighted
 * score built from vegetation/thermal signals alone.
 *
 * FieldHealthScore = (w_NDVI × S_NDVI) + (w_NDRE × S_NDRE) + (w_Thermal × S_Thermal)
 *
 * Weather is still used for disease hypothesis detection in riskService.js
 * but does NOT contribute to this health score.
 *
 * CONVENTION: 0–100 scale, higher = healthier. Matches the convention used
 * in riskService.js and risk_fusion.py.
 *
 * FALSE-ALARM GATE: No single signal at max stress can push the score
 * below 60 (WATCH). Max single weight is 0.40 → 100 − 40 = 60. Reaching
 * ELEVATED (score < 40) requires at least two signals to corroborate.
 */

import NdviReading from '../models/NdviReading.js';
import ThermalReading from '../models/ThermalReading.js';
import CropBaseline from '../models/CropBaseline.js';
import Field from '../models/Field.js';
import User from '../models/User.js';

// ─── Health Levels ────────────────────────────────────────────────────────

export const HealthLevel = Object.freeze({
  HEALTHY: 'healthy',
  WATCH: 'watch',
  ELEVATED: 'elevated',
  HIGH: 'high',
});

// ─── Default Baselines (literature-typical; cold-start fallback) ──────────
// NDRE range is a literature-typical assumption, NOT derived from this
// project's own data. NEEDS_CALIBRATION once real calibrated data is
// available from the weekly baseline recomputation cron job.

export const DEFAULT_NDVI_BASELINE = { min: 0.0, max: 0.9 };
export const DEFAULT_NDRE_BASELINE = { min: -0.1, max: 0.7 };

// ─── Per-crop CWSI Regression Coefficients ───────────────────────────────
// Empirical CWSI (Idso method):
//   CWSI = clamp((dT - dT_lower) / (dT_upper - dT_lower), 0, 1)
//   dT = T_canopy - T_air
//   dT_lower = slope_lower × VPD + intercept_lower
//   dT_upper = slope_upper × VPD + intercept_upper
//
// All coefficients below are NEEDS_CALIBRATION — seeded with published
// approximate values for major crops, not empirically fit from this
// project's own data. Replace with real regression coefficients as
// ground-referenced canopy temperature / soil moisture data accumulates.

const CWSI_REGRESSION = {
  cotton: {
    lower: { slope: -2.5, intercept: -1.0 },
    upper: { slope: 1.8, intercept: 6.0 },
  },
  rice: {
    lower: { slope: -2.8, intercept: -1.2 },
    upper: { slope: 2.0, intercept: 6.5 },
  },
  wheat: {
    lower: { slope: -2.2, intercept: -0.8 },
    upper: { slope: 1.5, intercept: 5.5 },
  },
  maize: {
    lower: { slope: -2.4, intercept: -0.9 },
    upper: { slope: 1.7, intercept: 5.8 },
  },
  soybean: {
    lower: { slope: -2.3, intercept: -0.85 },
    upper: { slope: 1.6, intercept: 5.6 },
  },
  sugarcane: {
    lower: { slope: -2.6, intercept: -1.1 },
    upper: { slope: 1.9, intercept: 6.2 },
  },
  potato: {
    lower: { slope: -2.0, intercept: -0.7 },
    upper: { slope: 1.4, intercept: 5.0 },
  },
  grapes: {
    lower: { slope: -1.8, intercept: -0.6 },
    upper: { slope: 1.3, intercept: 4.8 },
  },
  tur: {
    lower: { slope: -2.1, intercept: -0.75 },
    upper: { slope: 1.5, intercept: 5.2 },
  },
  default: {
    lower: { slope: -2.3, intercept: -0.9 },
    upper: { slope: 1.6, intercept: 5.5 },
  },
};

// ─── Growth-Stage Weight Scenarios ────────────────────────────────────────
// All weights sum to 1.0. Max single weight = 0.40 (hard cap).
// Single signal at max stress: 100 − (0.40 × 100) = 60 = WATCH.
// Two signals needed to reach ELEVATED (score < 40).

export const GROWTH_WEIGHTS = {
  balanced:     { ndvi: 0.40, ndre: 0.40, thermal: 0.20 },
  early_sparse: { ndvi: 0.40, ndre: 0.30, thermal: 0.30 },
  late_dense:   { ndvi: 0.30, ndre: 0.40, thermal: 0.30 },
  drought:      { ndvi: 0.30, ndre: 0.30, thermal: 0.40 },
};

// ─── Growth-Stage → Scenario Mapping ─────────────────────────────────────

const STAGE_TO_SCENARIO = {
  sowing:     'early_sparse',
  vegetative: 'early_sparse',
  flowering:  'balanced',
  fruiting:   'late_dense',
  maturity:   'late_dense',
  harvested:  null, // no active crop — skip scoring
};

// ─── Staleness Limits (days) ─────────────────────────────────────────────
// Independent per signal — NDVI/NDRE share Sentinel-2, thermal uses Landsat.

export const STALENESS_LIMIT_DAYS = {
  ndvi: 10,       // ~2 missed Sentinel-2 revisits
  ndre: 10,       // same Sentinel-2 image as ndvi
  thermal: 20,    // Landsat revisit is slower; extra slack
};

// ─── Drought Detection Thresholds ────────────────────────────────────────
// Auto-detect drought context from weather data — overrides growth-stage
// weights to emphasize thermal (water stress indicator).

const DROUGHT_RAINFALL_MAX_MM = 2.0;
const DROUGHT_TEMP_MIN_C = 35.0;

// ─── Cloud Cover Thresholds ──────────────────────────────────────────────
// NDVI/NDRE from Sentinel-2: clouds affect optical bands directly
// Thermal from Landsat: clouds affect thermal bands but less severely

const NDVI_CLOUD_THRESHOLD_PCT = 40;
const THERMAL_CLOUD_THRESHOLD_PCT = 50;

// ─── Resolution Mismatch ─────────────────────────────────────────────────
// Landsat thermal pixel = 30m × 30m = 0.09 ha. Fields smaller than this
// may have thermal readings contaminated by neighboring plots.

const THERMAL_PIXEL_AREA_HA = 0.09;

// ─── Stale Data Threshold ────────────────────────────────────────────────
// If staleness exceeds this, surface a "no recent satellite data" flag
// to the advisory layer rather than silently trusting old data.

const MAX_STALENESS_DAYS = 20;

// ─── Minimum Sample Size ─────────────────────────────────────────────────
// Below this threshold, baseline is marked as 'default' rather than
// 'calibrated'. This is a practical threshold, not derived from data.

const MIN_CALIBRATED_SAMPLE_SIZE = 30;

// ═══════════════════════════════════════════════════════════════════════════
// PURE FUNCTIONS (testable without I/O)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate Vapor Pressure Deficit (VPD) from air temperature and
 * relative humidity using the Tetens formula.
 *
 * VPD = e_sat − e_act
 * e_sat = 0.6108 × exp(17.27 × T / (T + 237.3))   [kPa]
 * e_act = e_sat × (RH / 100)
 *
 * @param {number} tempC - Air temperature in °C
 * @param {number} rh - Relative humidity in % (0-100)
 * @returns {number} VPD in kPa
 */
export function calculateVPD(tempC, rh) {
  if (rh <= 0) {
    // Air is completely dry — VPD = e_sat
    const eSat = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    return Math.round(eSat * 1000) / 1000;
  }
  if (rh >= 100) {
    // Air is saturated — VPD = 0
    return 0;
  }
  const eSat = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const eAct = eSat * (rh / 100);
  return Math.round((eSat - eAct) * 1000) / 1000;
}

/**
 * Normalize a raw NDVI value to a 0-100 health score.
 * Clamps to [0, 100] before scaling — raw NDVI can exceed bounds
 * (bare soil, water, saturated canopy).
 *
 * @param {number} ndvi - Raw NDVI value
 * @param {{ min: number, max: number }} baseline - NDVI min/max percentiles
 * @returns {number} 0-100 score
 */
export function normalizeNdviToScore(ndvi, baseline = DEFAULT_NDVI_BASELINE) {
  const { min, max } = baseline;
  if (max === min) return 50; // degenerate baseline — return neutral
  const normalized = (ndvi - min) / (max - min);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100 * 10) / 10;
}

/**
 * Normalize a raw NDRE value to a 0-100 health score.
 * Same logic as NDVI normalization.
 *
 * @param {number} ndre - Raw NDRE value
 * @param {{ min: number, max: number }} baseline - NDRE min/max percentiles
 * @returns {number} 0-100 score
 */
export function normalizeNdreToScore(ndre, baseline = DEFAULT_NDRE_BASELINE) {
  const { min, max } = baseline;
  if (max === min) return 50;
  const normalized = (ndre - min) / (max - min);
  return Math.round(Math.max(0, Math.min(1, normalized)) * 100 * 10) / 10;
}

/**
 * Compute empirical CWSI (Crop Water Stress Index) using the Idso method.
 *
 * CWSI = clamp((dT − dT_lower) / (dT_upper − dT_lower), 0, 1)
 * where:
 *   dT = T_canopy − T_air
 *   dT_lower = slope_lower × VPD + intercept_lower  (well-watered baseline)
 *   dT_upper = slope_upper × VPD + intercept_upper  (full stomatal closure)
 *
 * @param {Object} params
 * @param {number} params.tCanopy - Canopy temperature in °C (from Landsat LST)
 * @param {number} params.tAir - Air temperature in °C (from weather station)
 * @param {number|null} params.vpd - Vapor Pressure Deficit in kPa (null if unavailable)
 * @param {string|null} params.cropType - Crop type for regression coefficients
 * @returns {{ cwsi: number|null, confidence: string }}
 *   cwsi: 0-1 (0 = no stress, 1 = max stress), null if VPD unavailable
 *   confidence: 'high' | 'low'
 */
export function computeCWSI({ tCanopy, tAir, vpd, cropType = null }) {
  if (vpd === null || vpd === undefined) {
    return { cwsi: null, confidence: 'low' };
  }

  const cropKey = cropType?.toLowerCase() || 'default';
  const regression = CWSI_REGRESSION[cropKey] || CWSI_REGRESSION.default;

  const dT = tCanopy - tAir;
  const dT_lower = regression.lower.slope * vpd + regression.lower.intercept;
  const dT_upper = regression.upper.slope * vpd + regression.upper.intercept;

  // Avoid division by zero if baselines converge
  if (Math.abs(dT_upper - dT_lower) < 0.001) {
    return { cwsi: 0.5, confidence: 'low' };
  }

  const cwsi = Math.max(0, Math.min(1, (dT - dT_lower) / (dT_upper - dT_lower)));
  return { cwsi: Math.round(cwsi * 1000) / 1000, confidence: 'high' };
}

/**
 * Select weight scenario based on growth stage and context.
 *
 * @param {string|null} growthStage - Current crop stage
 * @param {Object} context - { isDrought: boolean }
 * @returns {{ ndvi: number, ndre: number, thermal: number }|null}
 *   null if harvested (no active crop)
 */
export function getWeights(growthStage, context = {}) {
  if (growthStage === 'harvested') return null;

  if (context.isDrought) return GROWTH_WEIGHTS.drought;

  const scenario = STAGE_TO_SCENARIO[growthStage] || 'balanced';
  return GROWTH_WEIGHTS[scenario];
}

/**
 * Classify a 0-100 health score into a HealthLevel.
 */
export function healthLevelForScore(score) {
  if (score >= 80) return HealthLevel.HEALTHY;
  if (score >= 60) return HealthLevel.WATCH;
  if (score >= 40) return HealthLevel.ELEVATED;
  return HealthLevel.HIGH;
}

/**
 * Check if a signal is stale (older than its staleness limit).
 */
export function isStale(signalName, lastUpdated, now) {
  if (!lastUpdated) return false;
  const limit = STALENESS_LIMIT_DAYS[signalName];
  if (limit === null || limit === undefined) return false;
  const ageMs = now.getTime() - new Date(lastUpdated).getTime();
  return ageMs > limit * 24 * 60 * 60 * 1000;
}

/**
 * Estimate number of thermal pixels that fit in the field area.
 * Used to detect resolution mismatch for small fields.
 */
export function estimateThermalPixelCount(areaInHectares) {
  if (!areaInHectares || areaInHectares <= 0) return null;
  return Math.round(areaInHectares / THERMAL_PIXEL_AREA_HA);
}

/**
 * Check if drought context is active from weather data.
 */
export function isDroughtContext(weatherReading) {
  if (!weatherReading) return false;
  return (
    (weatherReading.rainfallMm24h ?? 0) < DROUGHT_RAINFALL_MAX_MM &&
    (weatherReading.temperatureC ?? 0) > DROUGHT_TEMP_MIN_C
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATION (does I/O via DB queries)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolve the active field IDs belonging to a farm owner's district.
 * Reuses the pattern from thermalService.js.
 */
async function resolveDistrictFarmIds(farm) {
  if (!farm?.userId) return null;

  const owner = await User.findById(farm.userId)
    .select('farmDetails.district')
    .lean();
  const district = owner?.farmDetails?.district;
  if (!district) return null;

  const districtUsers = await User.find({ 'farmDetails.district': district })
    .select('_id')
    .lean();
  const userIds = districtUsers.map(u => u._id);
  if (userIds.length === 0) return null;

  const districtFields = await Field.find({
    userId: { $in: userIds },
    status: 'active',
    deletedAt: null,
  })
    .select('_id')
    .lean();

  return { district, farmIds: districtFields.map(f => f._id) };
}

/**
 * Fetch the most recent valid NDVI reading for a farm.
 * Applies cloud-cover gating: skips scenes with cloudCoverPct > threshold.
 * Returns { reading, isStale, lastValidAge }.
 */
async function fetchValidNdvi(farmId, now) {
  // Get the latest reading regardless of cloud cover
  const latest = await NdviReading.findOne({ farmId })
    .sort({ observedAt: -1 })
    .lean();

  if (!latest) {
    return { reading: null, isStale: true, lastValidAge: null };
  }

  // Check if the latest scene is cloudy
  if (latest.cloudCoverPct > NDVI_CLOUD_THRESHOLD_PCT) {
    // Cloudy — fall back to last valid (clear) reading
    const lastValid = await NdviReading.findOne({
      farmId,
      cloudCoverPct: { $lte: NDVI_CLOUD_THRESHOLD_PCT },
      observedAt: { $lt: latest.observedAt },
    })
      .sort({ observedAt: -1 })
      .lean();

    if (!lastValid) {
      // No clear reading found — mark as stale
      return { reading: latest, isStale: true, lastValidAge: null };
    }

    const ageMs = now.getTime() - new Date(lastValid.observedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return {
      reading: lastValid,
      isStale: ageDays > STALENESS_LIMIT_DAYS.ndvi,
      lastValidAge: ageDays,
    };
  }

  // Latest scene is clear — check staleness
  const ageMs = now.getTime() - new Date(latest.observedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return {
    reading: latest,
    isStale: ageDays > STALENESS_LIMIT_DAYS.ndvi,
    lastValidAge: ageDays,
  };
}

/**
 * Fetch the most recent valid thermal reading for a farm.
 * Applies cloud-cover gating for real Landsat scenes.
 * Returns { reading, isStale, lastValidAge, confidence }.
 */
async function fetchValidThermal(farmId, now) {
  const latest = await ThermalReading.findOne({ farmId })
    .sort({ observedAt: -1 })
    .lean();

  if (!latest) {
    return { reading: null, isStale: true, lastValidAge: null, confidence: 'low' };
  }

  // Formula-only readings are not real satellite data — flag as low confidence
  // but don't treat as cloudy (there's no cloud to check)
  if (latest.sceneSource !== 'landsat-8-9') {
    const ageMs = now.getTime() - new Date(latest.observedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return {
      reading: latest,
      isStale: ageDays > STALENESS_LIMIT_DAYS.thermal,
      lastValidAge: ageDays,
      confidence: 'low',
    };
  }

  // Real Landsat data — check cloud cover
  if (latest.cloudCoverPct > THERMAL_CLOUD_THRESHOLD_PCT) {
    // Cloudy Landsat scene — fall back to last valid reading
    const lastValid = await ThermalReading.findOne({
      farmId,
      sceneSource: 'landsat-8-9',
      cloudCoverPct: { $lte: THERMAL_CLOUD_THRESHOLD_PCT },
      observedAt: { $lt: latest.observedAt },
    })
      .sort({ observedAt: -1 })
      .lean();

    if (!lastValid) {
      return { reading: latest, isStale: true, lastValidAge: null, confidence: 'low' };
    }

    const ageMs = now.getTime() - new Date(lastValid.observedAt).getTime();
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    return {
      reading: lastValid,
      isStale: ageDays > STALENESS_LIMIT_DAYS.thermal,
      lastValidAge: ageDays,
      confidence: 'high',
    };
  }

  // Clear Landsat scene — check staleness
  const ageMs = now.getTime() - new Date(latest.observedAt).getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return {
    reading: latest,
    isStale: ageDays > STALENESS_LIMIT_DAYS.thermal,
    lastValidAge: ageDays,
    confidence: 'high',
  };
}

/**
 * Fetch calibrated baselines for a crop/region, falling back to defaults.
 */
async function fetchBaselines(cropType, district) {
  const cropKey = cropType?.toLowerCase();
  if (!cropKey) {
    return {
      ndvi: DEFAULT_NDVI_BASELINE,
      ndre: DEFAULT_NDRE_BASELINE,
      source: 'default',
    };
  }

  // Try calibrated baseline for this crop + district
  // Both keys are lowercased: Field.cropType enum is capitalized ('Cotton')
  // and User districts are free-text ('Pune'), while CropBaseline stores
  // lowercase keys.
  const regionKey = (district || 'global').toLowerCase();
  let baseline = await CropBaseline.findOne({
    cropType: cropKey,
    region: regionKey,
  }).lean();

  // Fall back to global region if no district-specific baseline
  if (!baseline && district) {
    baseline = await CropBaseline.findOne({
      cropType: cropKey,
      region: 'global',
    }).lean();
  }

  if (baseline && baseline.source === 'calibrated') {
    return {
      ndvi: { min: baseline.ndviP05, max: baseline.ndviP95 },
      ndre: { min: baseline.ndreP05, max: baseline.ndreP95 },
      source: 'calibrated',
    };
  }

  // No calibrated data — use literature defaults
  return {
    ndvi: DEFAULT_NDVI_BASELINE,
    ndre: DEFAULT_NDRE_BASELINE,
    source: 'default',
  };
}

/**
 * Compute the Field Health Score (0-100) for a farm.
 *
 * This is the main entry point — orchestrates data fetching, normalization,
 * weight selection, and weighted overlay into a single health score.
 *
 * @param {Object} farm - Farm document (must have _id, cropType, cropStage, areaInHectares)
 * @param {Object|null} weatherReading - Today's weather reading (for CWSI and drought detection)
 * @param {Date|null} now - Reference time (for testing)
 * @returns {Promise<Object>} Health score result
 */
export async function computeVegetationHealthScore(farm, weatherReading = null, now = null) {
  now = now || new Date();
  const farmId = farm._id;

  // ── 0. Harvested stage — no active crop, skip scoring ──
  if (farm.cropStage === 'harvested') {
    return {
      score: null,
      level: null,
      triggeredAlert: false,
      reason: 'harvested',
    };
  }

  // ── 1. Resolve district for baseline lookup ──
  let district = null;
  try {
    const districtInfo = await resolveDistrictFarmIds(farm);
    district = districtInfo?.district || null;
  } catch {
    // District resolution is best-effort
  }

  // ── 2. Fetch baselines ──
  const baselines = await fetchBaselines(farm.cropType, district);

  // ── 3. Fetch valid NDVI/NDRE readings ──
  const ndviResult = await fetchValidNdvi(farmId, now);
  const ndviReading = ndviResult.reading;

  // ── 4. Fetch valid thermal reading ──
  const thermalResult = await fetchValidThermal(farmId, now);
  const thermalReading = thermalResult.reading;

  // ── 5. Resolution mismatch detection ──
  const thermalPixels = estimateThermalPixelCount(farm.areaInHectares);
  let thermalResolutionConfidence = 'high';
  if (thermalPixels !== null && thermalPixels < 1) {
    thermalResolutionConfidence = 'low';
  }

  // ── 6. Select weights based on growth stage + context ──
  const droughtContext = isDroughtContext(weatherReading);
  const weights = getWeights(farm.cropStage, { isDrought: droughtContext });

  // ── 7. Compute VPD for CWSI ──
  let vpd = null;
  if (weatherReading?.temperatureC != null && weatherReading?.humidityPct != null) {
    vpd = calculateVPD(weatherReading.temperatureC, weatherReading.humidityPct);
  }

  // ── 8. Compute normalized sub-scores ──
  const staleSignals = [];
  const normalizedScores = {};

  // NDVI
  if (ndviReading?.ndvi != null) {
    normalizedScores.ndvi = {
      raw: ndviReading.ndvi,
      score: normalizeNdviToScore(ndviReading.ndvi, baselines.ndvi),
      baseline: { ...baselines.ndvi, source: baselines.source },
    };
    if (ndviResult.isStale) staleSignals.push('ndvi');
  }

  // NDRE
  if (ndviReading?.ndre != null) {
    normalizedScores.ndre = {
      raw: ndviReading.ndre,
      score: normalizeNdreToScore(ndviReading.ndre, baselines.ndre),
      baseline: { ...baselines.ndre, source: baselines.source },
    };
    if (ndviResult.isStale) staleSignals.push('ndre');
  }

  // Thermal
  if (thermalReading) {
    if (thermalReading.sceneSource === 'landsat-8-9' && vpd !== null) {
      // Real Landsat + VPD available → compute CWSI
      const { cwsi, confidence } = computeCWSI({
        tCanopy: thermalReading.estimatedCanopyTempC,
        tAir: weatherReading.temperatureC,
        vpd,
        cropType: farm.cropType,
      });
      if (cwsi !== null) {
        normalizedScores.thermal = {
          raw: thermalReading.estimatedCanopyTempC,
          cwsi,
          score: Math.round((1 - cwsi) * 100 * 10) / 10,
          confidence,
        };
      } else {
        // CWSI unavailable — fall back to percentile proxy
        normalizedScores.thermal = {
          raw: thermalReading.estimatedCanopyTempC,
          cwsi: null,
          score: null, // will use thermal anomaly as proxy
          confidence: 'low',
        };
      }
    } else {
      // Formula-only or no VPD — use anomaly as proxy
      const anomalyStress = thermalReading.anomalyC > 0
        ? Math.min(1, thermalReading.anomalyC / 10)
        : 0;
      normalizedScores.thermal = {
        raw: thermalReading.estimatedCanopyTempC,
        cwsi: null,
        score: Math.round((1 - anomalyStress) * 100 * 10) / 10,
        confidence: 'low',
      };
    }
    if (thermalResult.isStale) staleSignals.push('thermal');
  }

  // ── 9. Check for missing signals ──
  if (!normalizedScores.ndvi && !normalizedScores.ndre && !normalizedScores.thermal) {
    // No signals at all — cannot compute score
    return {
      score: null,
      level: null,
      triggeredAlert: false,
      reason: 'no_satellite_data',
      staleSignals: ['ndvi', 'ndre', 'thermal'],
      noRecentSatelliteData: true,
    };
  }

  // ── 10. Staleness redistribution ──
  // Drop stale signals and redistribute weights proportionally
  let activeWeights = { ...weights };
  for (const signal of staleSignals) {
    activeWeights[signal] = 0;
  }

  // Handle case where NDRE is missing (not stale, just not in reading)
  if (!normalizedScores.ndre && !staleSignals.includes('ndre')) {
    // NDRE not available — redistribute its weight to NDVI
    activeWeights.ndvi += activeWeights.ndre;
    activeWeights.ndre = 0;
  }

  let activeTotal = activeWeights.ndvi + activeWeights.ndre + activeWeights.thermal;
  if (activeTotal === 0) {
    // All signals stale — neutral fallback
    return {
      score: 50,
      level: HealthLevel.WATCH,
      triggeredAlert: false,
      reason: 'all_signals_stale',
      staleSignals,
      lowConfidence: true,
      weightsUsed: { ndvi: 0, ndre: 0, thermal: 0 },
      normalizedScores,
      baselineSource: baselines.source,
      thermalConfidence: thermalResolutionConfidence,
      maxSignalGapDays: 0,
      noRecentSatelliteData: staleSignals.length === 3,
    };
  }

  // Normalize weights to sum to 1.0
  const normalizedWeights = {
    ndvi: activeWeights.ndvi / activeTotal,
    ndre: activeWeights.ndre / activeTotal,
    thermal: activeWeights.thermal / activeTotal,
  };

  // ── 11. Compute composite score ──
  let weightedSum = 0;
  let signalsUsed = 0;

  if (normalizedScores.ndvi != null && normalizedWeights.ndvi > 0) {
    weightedSum += normalizedWeights.ndvi * normalizedScores.ndvi.score;
    signalsUsed++;
  }
  if (normalizedScores.ndre != null && normalizedWeights.ndre > 0) {
    weightedSum += normalizedWeights.ndre * normalizedScores.ndre.score;
    signalsUsed++;
  }
  if (normalizedScores.thermal != null && normalizedWeights.thermal > 0 && normalizedScores.thermal.score != null) {
    weightedSum += normalizedWeights.thermal * normalizedScores.thermal.score;
    signalsUsed++;
  }

  // If some signals were unavailable, renormalize remaining weights
  if (signalsUsed > 0 && signalsUsed < 3) {
    const usedWeightTotal =
      (normalizedScores.ndvi != null && normalizedWeights.ndvi > 0 ? normalizedWeights.ndvi : 0) +
      (normalizedScores.ndre != null && normalizedWeights.ndre > 0 ? normalizedWeights.ndre : 0) +
      (normalizedScores.thermal != null && normalizedWeights.thermal > 0 && normalizedScores.thermal.score != null ? normalizedWeights.thermal : 0);

    if (usedWeightTotal > 0 && usedWeightTotal < 1) {
      weightedSum = weightedSum / usedWeightTotal;
    }
  }

  const score = Math.max(0, Math.min(100, Math.round(weightedSum)));
  const level = healthLevelForScore(score);

  // ── 12. Compute metadata ──
  const signalDates = {
    ndvi: ndviReading?.observedAt || null,
    ndre: ndviReading?.observedAt || null, // same Sentinel-2 image
    thermal: thermalReading?.observedAt || null,
  };

  const dates = Object.values(signalDates).filter(Boolean).map(d => new Date(d));
  const maxGapDays = dates.length >= 2
    ? Math.round((Math.max(...dates) - Math.min(...dates)) / (24 * 60 * 60 * 1000))
    : 0;

  // Thermal confidence combines resolution and data quality
  const thermalConfidence = thermalResolutionConfidence === 'low'
    ? 'low'
    : thermalResult.confidence;

  const lowConfidence = thermalConfidence === 'low' || baselines.source === 'default';

  // ── 13. Return result ──
  return {
    score,
    level,
    triggeredAlert: level === HealthLevel.ELEVATED || level === HealthLevel.HIGH,
    weightsUsed: normalizedWeights,
    growthScenario: droughtContext ? 'drought' : (STAGE_TO_SCENARIO[farm.cropStage] || 'balanced'),
    staleSignals,
    maxSignalGapDays: Math.round(maxGapDays),
    baselineSource: baselines.source,
    thermalConfidence,
    lowConfidence,
    noRecentSatelliteData: maxGapDays > MAX_STALENESS_DAYS,
    normalizedScores,
    signalDates,
  };
}
