import RiskScore from '../models/RiskScore.js';
import Field from '../models/Field.js';
import DiagnosisCase from '../models/DiagnosisCase.js';
import { evaluateWeatherForFarm } from './weatherService.js';
import { fetchNdviForFarm, computeNdviComponent, computeNdreComponent, ndreToStress, isVegetationDetected, computeSpatialHotspot } from './ndviService.js';
import { computeThermalReading, computeThermalComponent, resolveDistrictFarmIds, getLatestThermalGrid } from './thermalService.js';

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
// HYPOTHESIS — NOT empirically calibrated (see §4a/4b of the scoring review).
// Proposed weights: Weather 20%, NDRE 30%, Thermal 25%, NDVI 15%, PestHistory 10%.
// Rationale:
//   • NDRE promoted to top weight: most sensitive early-disease/chlorophyll signal.
//   • NDVI demoted: canopy structure lags NDRE in early stress.
//   • PestHistory reduced: ambient context, not direct plant observation.
// Must be recalibrated from real outcome data before production confidence.
const CROP_WEIGHTS = {
  default:  { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  rice:     { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  cotton:   { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  soybean:  { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  wheat:    { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  potato:   { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  maize:    { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  sugarcane:{ weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  grapes:   { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
  tur:      { weather: 0.20, ndvi: 0.15, ndre: 0.30, thermal: 0.25, pestHistory: 0.10 },
};

// ─── Staleness limits (days) ────────────────────────────────────────────────
const STALENESS_LIMIT_DAYS = {
  weather: 2,
  ndvi: 10,         // ~2 missed Sentinel-2 revisits
  ndre: 10,         // same revisit cadence — same Sentinel-2 image as ndvi
  thermal: 20,      // Landsat/MODIS revisit is slow; extra slack
  pestHistory: null, // never goes stale — historical baseline
};

// ─── Crop-stage relevance multipliers ───────────────────────────────────────
const STAGE_RELEVANCE = {
  weather: {
    sowing: 0.8, vegetative: 1.0, flowering: 1.0,
    fruiting: 0.9, maturity: 0.7, harvested: 0.3,
  },
  ndvi: {
    sowing: 0.6, vegetative: 1.0, flowering: 1.0,
    fruiting: 0.9, maturity: 0.8, harvested: 0.4,
  },
  // NDRE tracks chlorophyll closely, so it is particularly relevant during
  // vegetative and early-stress phases, and starts to naturally decline
  // toward maturity/harvest (senescence) — mirrors ndvi profile.
  ndre: {
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
// KNOWN LIMITATION, not fixed here: on Vercel Functions this module-level
// object does not persist between invocations (no long-lived process), so
// recalibration effectively resets constantly in production even now that
// the key bug above is fixed. Needs a real store (e.g. a
// ThresholdAdjustment collection keyed the same way) before this is
// reliable outside local/dev.
const thresholdAdjustments = {};

// ─── Weight & Threshold Helpers ─────────────────────────────────────────────

export function getCropWeights(cropType) {
  const key = cropType?.toLowerCase();
  return CROP_WEIGHTS[key] || CROP_WEIGHTS.default;
}

// Both functions below previously used different keys for the same
// adjustment map (getAlertThreshold read `cropType`, recalibrateThreshold
// wrote `cropType_diseaseHypothesis`), so a recalibration after a false
// alarm never actually changed the threshold anything read. They now share
// one key-building helper, keyed by crop + disease hypothesis specifically
// (a false alarm on one disease hypothesis for a crop shouldn't blunt
// alerting for an unrelated hypothesis on the same crop).
function alertThresholdKey(cropType, diseaseHypothesis) {
  return `${cropType?.toLowerCase()}_${diseaseHypothesis || 'general'}`;
}

export function getAlertThreshold(cropType, diseaseHypothesis = null) {
  const cropKey = cropType?.toLowerCase();
  const base = BASE_ALERT_THRESHOLDS[cropKey] || BASE_ALERT_THRESHOLDS.default;
  const adjustment = thresholdAdjustments[alertThresholdKey(cropType, diseaseHypothesis)] || 0;
  return Math.min(base + adjustment, base + 0.15); // cap at +0.15 cumulative
}

/**
 * Recalibrate threshold after a false alarm (spec §7.4).
 * Called when a case resolves outcome='false_alarm'.
 * Nudges threshold up by +0.01, capped at +0.15 cumulative.
 */
export function recalibrateThreshold(cropType, diseaseHypothesis) {
  const key = alertThresholdKey(cropType, diseaseHypothesis);
  const current = thresholdAdjustments[key] || 0;
  if (current >= 0.15) return; // cap reached
  thresholdAdjustments[key] = Math.min(current + 0.01, 0.15);
  const cropKey = cropType?.toLowerCase();
  const base = BASE_ALERT_THRESHOLDS[cropKey] || BASE_ALERT_THRESHOLDS.default;
  console.log(`🔄 Threshold recalibrated for ${key}: ${base} + ${thresholdAdjustments[key]}`);
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

// Confirmed district cases in the trailing 90 days that saturate the
// component (1.0 stress). Spec §7.4 normalizes against a district
// baseline rate; with small pilot volumes a fixed band is the practical
// stand-in — tune this constant as real CROPSAP data accumulates.
const PEST_HISTORY_BAND = 5;

/**
 * Compute pest history component (spec §7.4).
 * Fraction of confirmed (non-false-alarm) cases for the same crop in
 * the farm's district over the trailing 90 days, normalized against a
 * district baseline band.
 *
 * District is resolved from the farm owner's profile; returns 0 (the
 * historical floor) when no district is set or no cases exist yet.
 */
async function computePestHistoryComponent(farm) {
  const cropType = farm?.cropType;
  if (!cropType) return 0;

  try {
    const info = await resolveDistrictFarmIds(farm);
    if (!info || info.farmIds.length === 0) return 0;

    const sameCropFields = await Field.find({
      _id: { $in: info.farmIds },
      cropType,
      deletedAt: null,
    }).select('_id').lean();
    if (sameCropFields.length === 0) return 0;

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const confirmed = await DiagnosisCase.countDocuments({
      farmId: { $in: sameCropFields.map(f => f._id) },
      createdAt: { $gte: since },
      status: { $ne: 'deleted' },
      outcome: { $in: ['confirmed', 'expert_review'] },
    });

    return Math.min(1, confirmed / PEST_HISTORY_BAND);
  } catch (err) {
    console.warn('Pest history component failed:', err.message);
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
 * @param {string|null} cropType - crop type, selects the weight profile (spec §7.4).
 *   Previously this function always used getCropWeights('default') regardless
 *   of the actual crop, so the entire per-crop CROP_WEIGHTS table (rice,
 *   cotton, wheat, ...) was dead code. It now selects the right profile.
 * @param {string|null} diseaseHypothesis - used to look up the adaptive
 *   alert threshold (spec §7.4) alongside the fixed 0-100 score bands.
 * @returns {{ score, level, weightsUsed, staleSignals, componentStress, triggeredAlert }}
 */
export function computeFusedHealthScore(stressComponents, signalDates = {}, cropStage = null, now = null, cropType = null, diseaseHypothesis = null) {
  now = now || new Date();
  const signalNames = ['weather', 'ndvi', 'ndre', 'thermal', 'pestHistory'];
  const baseWeights = getCropWeights(cropType);

  // 1. Detect stale signals
  const staleSignals = signalNames.filter(name =>
    isStale(name, signalDates[name], now)
  );

  // 2. Compute active weights (drop stale, redistribute proportionally)
  const activeWeights = {};
  for (const name of signalNames) {
    activeWeights[name] = staleSignals.includes(name) ? 0.0 : (baseWeights[name] || 0);
  }
  let activeTotal = Object.values(activeWeights).reduce((sum, w) => sum + w, 0);

  // Fallback: if ALL fresh signals are stale, use historical alone
  if (activeTotal === 0) {
    activeWeights.weather = 0;
    activeWeights.ndvi = 0;
    activeWeights.ndre = 0;
    activeWeights.thermal = 0;
    activeWeights.pestHistory = 1.0;
    activeTotal = 1.0;
  }

  // Normalize weights to sum to 1.0
  const normalizedWeights = {};
  for (const name of signalNames) {
    normalizedWeights[name] = activeTotal > 0 ? activeWeights[name] / activeTotal : 0;
  }

  // 3. Apply crop-stage relevance, then compute weighted stress.
  //
  // Weather and thermal are NOT independent: a heatwave raises both simultaneously.
  // NDVI and NDRE measure the plant's actual state so are more independent of each
  // other (NDRE measures chlorophyll, NDVI canopy structure — they can diverge in
  // early stress when chlorophyll drops before canopy closes). Only weather/thermal
  // get the overlap discount.
  const WEATHER_THERMAL_OVERLAP_DISCOUNT = 0.5;

  const componentStress = {};
  const effectiveStress = {};
  for (const name of signalNames) {
    const relevance = getStageRelevance(name, cropStage);
    const stress = stressComponents[name] || 0;
    effectiveStress[name] = stress * relevance;
    componentStress[name] = Math.round(effectiveStress[name] * 1000) / 1000;
  }

  const weightedWeather = normalizedWeights.weather * effectiveStress.weather;
  const weightedThermal = normalizedWeights.thermal * effectiveStress.thermal;
  const weightedNdvi = normalizedWeights.ndvi * effectiveStress.ndvi;
  const weightedNdre = normalizedWeights.ndre * effectiveStress.ndre;
  const weightedPest = normalizedWeights.pestHistory * effectiveStress.pestHistory;

  const weatherThermalOverlap = WEATHER_THERMAL_OVERLAP_DISCOUNT * Math.min(weightedWeather, weightedThermal);

  let weightedStress = weightedWeather + weightedThermal + weightedNdvi + weightedNdre + weightedPest - weatherThermalOverlap;
  weightedStress = Math.max(0, weightedStress);

  // 4. Convert to health score (0-100, higher = healthier)
  const score = Math.max(0, Math.min(Math.round(100 * (1 - weightedStress)), 100));
  let level = healthLevelForScore(score);

  // 5. Adaptive stress threshold (spec §7.4)
  const alertThreshold = getAlertThreshold(cropType, diseaseHypothesis);
  if (level === HealthLevel.WATCH && weightedStress >= alertThreshold) {
    level = HealthLevel.ELEVATED;
  }

  return {
    score,
    level,
    weightsUsed: Object.fromEntries(
      Object.entries(normalizedWeights).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
    ),
    staleSignals,
    componentStress,
    triggeredAlert: shouldPromptForPhoto(level),
    alertThresholdUsed: Math.round(alertThreshold * 1000) / 1000,
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

  // ── 2. Compute thermal reading ──
  // Previously this only ran `if (weatherEval.weatherReading)`, which meant
  // ANY farm with a stale/missing weather poll got no thermal reading at
  // all — even via real Landsat, which doesn't need weather data except as
  // its own last-resort fallback. computeThermalReading already handles a
  // null weatherReading correctly (it only throws if Landsat ALSO isn't
  // available), so call it unconditionally and just don't let a thermal
  // failure take down the whole risk score.
  let thermalReading = null;
  try {
    thermalReading = await computeThermalReading(farm, weatherEval.weatherReading || null);
  } catch (err) {
    console.warn('Thermal reading unavailable:', err.message);
  }

  // ── 3. Compute all 4 component stress scores (0-1, 1 = max stress) ──
  const weatherStress = weatherEval.score;
  const ndviStress = await computeNdviComponent(farmId, farm.cropType, farm.cropStage, farm);
  const thermalStress = await computeThermalComponent(farmId, weatherEval.weatherReading || null, farm.cropType || null);
  const pestHistoryStress = await computePestHistoryComponent(farm);

  // ── 4. Staleness-aware weighted fusion → health score (0-100) ──
  const ndreStress = await computeNdreComponent(farmId);

  const stressComponents = {
    weather: weatherStress,
    ndvi: ndviStress,
    ndre: ndreStress,
    thermal: thermalStress,
    pestHistory: pestHistoryStress,
  };

  const signalDates = {
    weather: weatherEval.weatherReading?.observedAt || new Date(),
    ndvi: ndviReading?.observedAt || new Date(),
    ndre: ndviReading?.observedAt || new Date(),  // same Sentinel-2 image as ndvi
    thermal: thermalReading?.observedAt || null,
    pestHistory: null, // historical never goes stale
  };

  const fusionResult = computeFusedHealthScore(
    stressComponents,
    signalDates,
    farm.cropStage || null,
    null,
    farm.cropType || null,
    weatherEval.diseaseHypothesis || null,
  );

  // ── 4b. Field validity override ──
  // "Is there any vegetation here at all" and "how stressed is the crop"
  // are different questions. The weighted fusion above answers the
  // second one and structurally CANNOT answer the first: NDVI/NDRE are
  // only ~30-45% of the total weight, so even maximal vegetation-index
  // stress can only drag compositeScore down to roughly
  // 100 * (1 - ndviWeight) — never to 0 — because weather/thermal/
  // pestHistory measure ambient/regional conditions that don't depend on
  // whether this specific polygon has plants on it. When both NDVI and
  // NDRE independently agree there's no vegetation (e.g. a boundary
  // mistakenly drawn over a building), report that plainly instead of a
  // misleadingly moderate score. This does not touch triggeredAlert —
  // this is a boundary/data-entry problem, not a disease signal, so it
  // should not send the farmer a "possible disease, upload a photo"
  // prompt.
  const vegetationDetected = isVegetationDetected(ndviReading?.ndvi, ndviReading?.ndre, ndviReading?.sceneSource);
  if (!vegetationDetected) {
    // "No vegetation detected" is a distinct field STATUS, not a health score.
    // Setting score=0/level='high' conflates a misdrawn/fallow/unplanted
    // boundary with a genuinely diseased crop — both would look identical in
    // the UI ("0/100 — High Risk"), eroding farmer trust with false alarms.
    // null correctly signals "not applicable right now": no score exists because
    // the scoring question ("how stressed is the crop") can't be answered when
    // there's no crop visible. The noVegetationDetected flag is what the
    // frontend uses to render a neutral "Fallow / Unplanted / No Vegetation
    // Detected" badge — not a red alert. triggeredAlert stays false (already set).
    fusionResult.score = null;
    fusionResult.level = null;
    fusionResult.triggeredAlert = false;
  }

  // ── 4c. Spatial Hotspot Analysis (§4d) ──
  const spatialAnomaly = computeSpatialHotspot(
    ndviReading?.ndviGrid || null,
    ndviReading?.ndreGrid || null,
    thermalReading?.thermalGrid || null
  );

  // ── 5. Save ──
  const riskScore = await RiskScore.create({
    farmId,
    computedAt: new Date(),
    weatherComponent: Math.round(weatherStress * 1000) / 1000,
    ndviComponent: Math.round(ndviStress * 1000) / 1000,
    ndreComponent: Math.round(ndreStress * 1000) / 1000,  // now an independent signal, not a folded sub-score
    thermalComponent: Math.round(thermalStress * 1000) / 1000,
    pestHistoryComponent: Math.round(pestHistoryStress * 1000) / 1000,
    compositeScore: fusionResult.score,   // 0-100 health score
    triggeredAlert: fusionResult.triggeredAlert,
    healthLevel: fusionResult.level,
    staleSignals: fusionResult.staleSignals,
    thresholdUsed: fusionResult.alertThresholdUsed,
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
      dataSources: {
        ndvi: ndviReading?.sceneSource || 'unknown',
        thermal: thermalReading?.sceneSource || 'unknown',
      },
      groundTruthVerified: ndviReading?.sceneSource === 'sentinel-2' || thermalReading?.sceneSource === 'landsat-8-9',
      noVegetationDetected: !vegetationDetected,
      spatialAnomaly,
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