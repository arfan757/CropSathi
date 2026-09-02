import RiskScore from '../models/RiskScore.js';
import Field from '../models/Field.js';
import { evaluateWeatherForFarm } from './weatherService.js';
import { fetchNdviForFarm, computeNdviComponent } from './ndviService.js';
import { computeThermalReading, computeThermalComponent } from './thermalService.js';

// ─── Health Levels (from risk_fusion.py) ────────────────────────────────────
// score >= 80  → healthy  (no action)
// score >= 60  → watch    (visible in-app, no push alert)
// score >= 40  → elevated (triggers "Farmer Prompted to Upload Photos")
// score <  40  → high     (same trigger, higher-priority notification)
export const HealthLevel = Object.freeze({
  HEALTHY: 'healthy',
  WATCH: 'watch',
  ELEVATED: 'elevated',
  HIGH: 'high',
});

// ─── Per-crop configurable weights (spec §7.4) ─────────────────────────────
const CROP_WEIGHTS = {
  default:  { weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
  rice:     { weather: 0.30, ndvi: 0.35, thermal: 0.15, pestHistory: 0.20 },
  cotton:   { weather: 0.40, ndvi: 0.25, thermal: 0.15, pestHistory: 0.20 },
  soybean:  { weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
  wheat:    { weather: 0.40, ndvi: 0.25, thermal: 0.15, pestHistory: 0.20 },
  potato:   { weather: 0.35, ndvi: 0.30, thermal: 0.20, pestHistory: 0.15 },
  maize:    { weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
  sugarcane:{ weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
  grapes:   { weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
  tur:      { weather: 0.35, ndvi: 0.30, thermal: 0.15, pestHistory: 0.20 },
};

// ─── Staleness limits (days) ────────────────────────────────────────────────
// A signal older than this is dropped and its weight redistributes to fresh
// signals, rather than being trusted as current or zeroed out.
const STALENESS_LIMIT_DAYS = {
  weather: 2,      // should essentially never trigger — no satellite gap
  ndvi: 10,         // ~2 missed Sentinel-2 revisits
  thermal: 20,      // Landsat/MODIS revisit is already slow; extra slack
  pestHistory: null, // never goes stale — historical baseline
};

// ─── Crop-stage relevance multipliers ───────────────────────────────────────
// Per-signal relevance (0-1) for the crop's current stage. A disease that
// only strikes at flowering shouldn't penalize the score during vegetative.
// Defaults to 1.0 (full relevance) when stage is unknown.
const STAGE_RELEVANCE = {
  weather: {
    sowing: 0.8, vegetative: 1.0, flowering: 1.0,
    fruiting: 0.9, maturity: 0.7, harvested: 0.3,
  },
  ndvi: {
    sowing: 0.6, vegetative: 1.0, flowering: 1.0,
    fruiting: 0.9, maturity: 0.8, harvested: 0.4,
  },
  thermal: {
    sowing: 0.7, vegetative: 1.0, flowering: 1.0,
    fruiting: 0.9, maturity: 0.8, harvested: 0.3,
  },
  pestHistory: {
    sowing: 0.5, vegetative: 0.8, flowering: 1.0,
    fruiting: 1.0, maturity: 0.7, harvested: 0.2,
  },
};

// ─── Alert threshold per crop (default 0.6 on the 0-1 stress scale) ─────────
// Note: threshold applies to the intermediate stress score BEFORE health
// conversion. On the 0-100 health scale, "elevated" = health < 40.
const BASE_ALERT_THRESHOLDS = {
  default: 0.6,
  cotton: 0.6,
  soybean: 0.55,
  wheat: 0.6,
  rice: 0.55,
  potato: 0.6,
  maize: 0.6,
  sugarcane: 0.6,
  grapes: 0.6,
  tur: 0.6,
};

// In-memory threshold adjustments (reset on server restart — persisted in DB would be better)
const thresholdAdjustments = {};

// ─── Weight & Threshold Helpers ─────────────────────────────────────────────

export function getCropWeights(cropType) {
  const key = cropType?.toLowerCase();
  return CROP_WEIGHTS[key] || CROP_WEIGHTS.default;
}

export function getAlertThreshold(cropType) {
  const key = cropType?.toLowerCase();
  const base = BASE_ALERT_THRESHOLDS[key] || BASE_ALERT_THRESHOLDS.default;
  const adjustment = thresholdAdjustments[key] || 0;
  return Math.min(base + adjustment, base + 0.15); // cap at +0.15 cumulative
}

/**
 * Recalibrate threshold after a false alarm (spec §7.4).
 * Called when a case resolves outcome='false_alarm'.
 * Nudges threshold up by +0.01, capped at +0.15 cumulative.
 */
export function recalibrateThreshold(cropType, diseaseHypothesis) {
  const key = `${cropType?.toLowerCase()}_${diseaseHypothesis || 'general'}`;
  const current = thresholdAdjustments[key] || 0;
  if (current >= 0.15) return; // cap reached
  thresholdAdjustments[key] = Math.min(current + 0.01, 0.15);
  console.log(`🔄 Threshold recalibrated for ${key}: ${BASE_ALERT_THRESHOLDS.default} + ${thresholdAdjustments[key]}`);
}

// ─── Health Level Classification ────────────────────────────────────────────

/**
 * Classify a 0-100 health score into a HealthLevel.
 * Mirrors risk_fusion.py's _level_for_score().
 */
export function healthLevelForScore(score) {
  if (score >= 80) return HealthLevel.HEALTHY;
  if (score >= 60) return HealthLevel.WATCH;
  if (score >= 40) return HealthLevel.ELEVATED;
  return HealthLevel.HIGH;
}

/**
 * The false-alarm gate rule from PRD.md Part 2:
 * This score never auto-declares a diagnosis. It only ever decides
 * whether to ask the farmer for a confirming photo.
 */
export function shouldPromptForPhoto(healthLevel) {
  return healthLevel === HealthLevel.ELEVATED || healthLevel === HealthLevel.HIGH;
}

// ─── Staleness Detection ───────────────────────────────────────────────────

/**
 * Check if a signal is stale (older than its staleness limit).
 * Returns true if the signal should be dropped from fusion.
 */
export function isStale(signalName, lastUpdated, now) {
  if (!lastUpdated) return false;
  const limit = STALENESS_LIMIT_DAYS[signalName];
  if (limit === null || limit === undefined) return false;
  const ageMs = now.getTime() - new Date(lastUpdated).getTime();
  return ageMs > limit * 24 * 60 * 60 * 1000;
}

// ─── Crop-Stage Relevance ──────────────────────────────────────────────────

/**
 * Get the relevance multiplier for a signal at a given crop stage.
 * Returns 1.0 if stage is unknown.
 */
function getStageRelevance(signalName, cropStage) {
  if (!cropStage) return 1.0;
  const signalRelevance = STAGE_RELEVANCE[signalName];
  if (!signalRelevance) return 1.0;
  return signalRelevance[cropStage] ?? 1.0;
}

// ─── Pest History Component ─────────────────────────────────────────────────

/**
 * Compute pest history component.
 * Fraction of confirmed (non-false-alarm) cases for same crop in trailing 90 days,
 * normalized against a district baseline rate.
 *
 * Currently returns 0 — will be wired when DiagnosisCase model is added.
 */
async function computePestHistoryComponent(farmId, cropType) {
  try {
    // Placeholder: will query DiagnosisCase when model exists
    return 0;
  } catch {
    return 0;
  }
}

// ─── Core Health Score Fusion ───────────────────────────────────────────────

/**
 * Pure fusion function — computes a 0-100 HEALTH score from component stress
 * values. Mirrors risk_fusion.py's compute_health_score().
 *
 * Higher score = healthier field.
 *
 * @param {Object} stressComponents - { weather, ndvi, thermal, pestHistory } (0-1 each, 1 = max stress)
 * @param {Object} signalDates - { weather, ndvi, thermal, pestHistory } Date or ISO string
 * @param {string|null} cropStage - current crop stage for relevance gating
 * @param {Date|null} now - reference time (for testing)
 * @returns {{ score, level, weightsUsed, staleSignals, componentStress, triggeredAlert }}
 */
export function computeFusedHealthScore(stressComponents, signalDates = {}, cropStage = null, now = null) {
  now = now || new Date();
  const signalNames = ['weather', 'ndvi', 'thermal', 'pestHistory'];
  const baseWeights = getCropWeights('default');

  // 1. Detect stale signals
  const staleSignals = signalNames.filter(name =>
    isStale(name, signalDates[name], now)
  );

  // 2. Compute active weights (drop stale, redistribute proportionally)
  const activeWeights = {};
  for (const name of signalNames) {
    activeWeights[name] = staleSignals.includes(name) ? 0.0 : baseWeights[name];
  }
  let activeTotal = Object.values(activeWeights).reduce((sum, w) => sum + w, 0);

  // Fallback: if ALL fresh signals are stale, use historical alone
  if (activeTotal === 0) {
    activeWeights.weather = 0;
    activeWeights.ndvi = 0;
    activeWeights.thermal = 0;
    activeWeights.pestHistory = 1.0;
    activeTotal = 1.0;
  }

  // Normalize weights to sum to 1.0
  const normalizedWeights = {};
  for (const name of signalNames) {
    normalizedWeights[name] = activeTotal > 0 ? activeWeights[name] / activeTotal : 0;
  }

  // 3. Apply crop-stage relevance and compute weighted stress
  let weightedStress = 0.0;
  const componentStress = {};
  for (const name of signalNames) {
    const w = normalizedWeights[name];
    const relevance = getStageRelevance(name, cropStage);
    const stress = stressComponents[name] || 0;
    const effectiveStress = stress * relevance;
    componentStress[name] = Math.round(effectiveStress * 1000) / 1000;
    weightedStress += w * effectiveStress;
  }

  // 4. Convert to health score (0-100, higher = healthier)
  const score = Math.max(0, Math.min(Math.round(100 * (1 - weightedStress)), 100));
  const level = healthLevelForScore(score);

  return {
    score,
    level,
    weightsUsed: Object.fromEntries(
      Object.entries(normalizedWeights).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
    ),
    staleSignals,
    componentStress,
    triggeredAlert: shouldPromptForPhoto(level),
  };
}

// ─── Core Risk Computation ──────────────────────────────────────────────────

/**
 * Compute composite health score for a farm.
 * Orchestrates all 4 services: weather, NDVI, thermal, pest history.
 *
 * Steps:
 * 1. Fetch fresh NDVI reading (simulated)
 * 2. Fetch fresh thermal reading from weather data
 * 3. Evaluate weather rules for disease hypothesis
 * 4. Compute all 4 component stress scores (0-1, 1 = max stress)
 * 5. Staleness-aware weighted fusion → health score (0-100, higher = healthier)
 * 6. Classify health level
 * 7. Save RiskScore document
 */
export async function computeRiskScore(farmId) {
  const farm = await Field.findById(farmId);
  if (!farm) throw new Error('Farm not found');

  // ── 1. Fetch fresh sensor data ──
  const [ndviReading, weatherEval] = await Promise.all([
    fetchNdviForFarm(farm),
    evaluateWeatherForFarm(farmId),
  ]);

  // ── 2. Compute thermal reading from weather ──
  let thermalReading = null;
  if (weatherEval.weatherReading) {
    thermalReading = await computeThermalReading(farm, weatherEval.weatherReading);
  }

  // ── 3. Compute all 4 component stress scores (0-1, 1 = max stress) ──
  const weatherStress = weatherEval.score;
  const ndviStress = await computeNdviComponent(farmId);
  const thermalStress = await computeThermalComponent(farmId);
  const pestHistoryStress = await computePestHistoryComponent(farmId, farm.cropType);

  // ── 4. Staleness-aware weighted fusion → health score (0-100) ──
  const stressComponents = {
    weather: weatherStress,
    ndvi: ndviStress,
    thermal: thermalStress,
    pestHistory: pestHistoryStress,
  };

  const signalDates = {
    weather: weatherEval.weatherReading?.observedAt || new Date(),
    ndvi: ndviReading?.observedAt || new Date(),
    thermal: thermalReading?.observedAt || null,
    pestHistory: null, // historical never goes stale
  };

  const fusionResult = computeFusedHealthScore(
    stressComponents,
    signalDates,
    farm.cropStage || null,
  );

  // ── 5. Save ──
  const riskScore = await RiskScore.create({
    farmId,
    computedAt: new Date(),
    weatherComponent: Math.round(weatherStress * 1000) / 1000,
    ndviComponent: Math.round(ndviStress * 1000) / 1000,
    thermalComponent: Math.round(thermalStress * 1000) / 1000,
    pestHistoryComponent: Math.round(pestHistoryStress * 1000) / 1000,
    compositeScore: fusionResult.score,   // 0-100 health score
    triggeredAlert: fusionResult.triggeredAlert,
    healthLevel: fusionResult.level,
    staleSignals: fusionResult.staleSignals,
    diseaseHypothesis: weatherEval.diseaseHypothesis,
    matchedWeatherRules: weatherEval.matchedRules || [],
    weightsUsed: fusionResult.weightsUsed,
    inputsSnapshot: {
      weatherReadingId: weatherEval.weatherReading?._id,
      ndviReadingId: ndviReading?._id,
      thermalReadingId: thermalReading?._id,
      weights: fusionResult.weightsUsed,
      cropType: farm.cropType,
      cropStage: farm.cropStage,
      source: 'riskService',
    },
  });

  // Update farm timestamps
  await Field.findByIdAndUpdate(farmId, { lastRiskScoreAt: new Date() });

  return riskScore;
}

/**
 * Batch compute risk scores for all active farms.
 * Used by cron jobs — processes farms oldest-first, bounded batch.
 */
export async function computeRiskScoresForAllActiveFarms(batchSize = 50) {
  const farms = await Field.find({ status: 'active' })
    .sort({ lastRiskScoreAt: 1 })
    .limit(batchSize)
    .lean();

  const results = [];
  for (const farm of farms) {
    try {
      const score = await computeRiskScore(farm._id);
      results.push({ farmId: farm._id, success: true, compositeScore: score.compositeScore });
    } catch (err) {
      results.push({ farmId: farm._id, success: false, error: err.message });
    }
  }

  return results;
}

// ─── Query Helpers ──────────────────────────────────────────────────────────

export async function getRiskHistory(farmId, limit = 20, cursor = null) {
  const query = { farmId };
  if (cursor) {
    query.computedAt = { $lt: new Date(cursor) };
  }
  return RiskScore.find(query)
    .sort({ computedAt: -1 })
    .limit(limit)
    .lean();
}

export async function getLatestRiskScore(farmId) {
  return RiskScore.findOne({ farmId })
    .sort({ computedAt: -1 })
    .lean();
}
