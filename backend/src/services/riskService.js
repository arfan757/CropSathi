import RiskScore from '../models/RiskScore.js';
import Field from '../models/Field.js';
import DiagnosisCase from '../models/DiagnosisCase.js';
import { evaluateWeatherForFarm } from './weatherService.js';
import { fetchNdviForFarm, isVegetationDetected, computeSpatialHotspot } from './ndviService.js';
import { computeThermalReading, resolveDistrictFarmIds, getLatestThermalGrid } from './thermalService.js';
import { createNotification } from './notificationService.js';
import { computeVegetationHealthScore, HealthLevel as VegetationHealthLevel, healthLevelForScore as vegetationHealthLevelForScore, isStale as vegetationIsStale, STALENESS_LIMIT_DAYS } from './vegetationHealth.js';

// ─── Health Levels ────────────────────────────────────────────────────────
// Re-export from vegetationHealth for backwards compatibility.
// score >= 80  → healthy  (no action)
// score >= 60  → watch    (visible in-app, no push alert)
// score >= 40  → elevated (triggers "Farmer Prompted to Upload Photos")
// score <  40  → high     (same trigger, higher-priority notification)
export const HealthLevel = VegetationHealthLevel;

// ─── Alert threshold per crop ─────────────────────────────────────────────
// On the 0-100 health scale, "elevated" = health < 40.
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

const thresholdAdjustments = {};

function alertThresholdKey(cropType, diseaseHypothesis) {
  return `${cropType?.toLowerCase()}_${diseaseHypothesis || 'general'}`;
}

export function getAlertThreshold(cropType, diseaseHypothesis = null) {
  const cropKey = cropType?.toLowerCase();
  const base = BASE_ALERT_THRESHOLDS[cropKey] || BASE_ALERT_THRESHOLDS.default;
  const adjustment = thresholdAdjustments[alertThresholdKey(cropType, diseaseHypothesis)] || 0;
  return Math.min(base + adjustment, base + 0.15);
}

export function recalibrateThreshold(cropType, diseaseHypothesis) {
  const key = alertThresholdKey(cropType, diseaseHypothesis);
  const current = thresholdAdjustments[key] || 0;
  if (current >= 0.15) return;
  thresholdAdjustments[key] = Math.min(current + 0.01, 0.15);
  const cropKey = cropType?.toLowerCase();
  const base = BASE_ALERT_THRESHOLDS[cropKey] || BASE_ALERT_THRESHOLDS.default;
  console.log(`🔄 Threshold recalibrated for ${key}: ${base} + ${thresholdAdjustments[key]}`);
}

// ─── Health Level Classification ──────────────────────────────────────────

export function healthLevelForScore(score) {
  return vegetationHealthLevelForScore(score);
}

/**
 * The false-alarm gate rule from PRD.md Part 2:
 * This score never auto-declares a diagnosis. It only ever decides
 * whether to ask the farmer for a confirming photo.
 */
export function shouldPromptForPhoto(healthLevel) {
  return healthLevel === HealthLevel.ELEVATED || healthLevel === HealthLevel.HIGH;
}

// ─── Staleness Detection ─────────────────────────────────────────────────

export function isStale(signalName, lastUpdated, now) {
  return vegetationIsStale(signalName, lastUpdated, now);
}

// ─── Weight Helper (delegates to vegetationHealth) ────────────────────────

export function getCropWeights(cropType) {
  // Kept for backwards compatibility — weights are now scenario-based
  // in vegetationHealth.js, not per-crop. Returns balanced defaults.
  return { ndvi: 0.40, ndre: 0.40, thermal: 0.20 };
}

// ─── Pest History Component (diagnostic only, not in health score) ────────

const PEST_HISTORY_BAND = 5;

/**
 * Compute pest history component — diagnostic signal only.
 * NOT used in the health score fusion. Stored on RiskScore for
 * advisory/context purposes.
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

// ─── Core Health Score Fusion ─────────────────────────────────────────────

/**
 * Compute a 0-100 HEALTH score from component stress values.
 *
 * DEPRECATED: This function uses the old fusion logic for backwards
 * compatibility with existing tests. New code should use
 * computeVegetationHealthScore() from vegetationHealth.js directly.
 *
 * @param {Object} stressComponents - { ndvi, ndre, thermal } (0-1 each, 1 = max stress)
 * @param {Object} signalDates - { ndvi, ndre, thermal } Date or ISO string
 * @param {string|null} cropStage - current crop stage
 * @param {Date|null} now - reference time (for testing)
 * @param {string|null} cropType - crop type (unused in new system)
 * @param {string|null} diseaseHypothesis - unused in new system
 * @returns {{ score, level, weightsUsed, staleSignals, componentStress, triggeredAlert }}
 */
export function computeFusedHealthScore(stressComponents, signalDates = {}, cropStage = null, now = null, cropType = null, diseaseHypothesis = null) {
  now = now || new Date();
  const signalNames = ['ndvi', 'ndre', 'thermal'];

  // Scenario-based weights (inlined from vegetationHealth.js)
  const STAGE_TO_SCENARIO = {
    sowing: 'early_sparse', vegetative: 'early_sparse',
    flowering: 'balanced', fruiting: 'late_dense',
    maturity: 'late_dense', harvested: null,
  };
  const GROWTH_WEIGHTS = {
    balanced:     { ndvi: 0.40, ndre: 0.40, thermal: 0.20 },
    early_sparse: { ndvi: 0.40, ndre: 0.30, thermal: 0.30 },
    late_dense:   { ndvi: 0.30, ndre: 0.40, thermal: 0.30 },
  };

  let weights;
  if (cropStage === 'harvested') {
    weights = null;
  } else {
    const scenario = STAGE_TO_SCENARIO[cropStage] || 'balanced';
    weights = GROWTH_WEIGHTS[scenario];
  }

  // Detect stale signals
  const staleSignals = signalNames.filter(name =>
    isStale(name, signalDates[name], now)
  );

  // Compute active weights (drop stale, redistribute proportionally)
  const activeWeights = {};
  for (const name of signalNames) {
    activeWeights[name] = staleSignals.includes(name) ? 0.0 : (weights?.[name] || 0);
  }
  let activeTotal = Object.values(activeWeights).reduce((sum, w) => sum + w, 0);

  // Fallback: if ALL signals are stale, return neutral score
  if (activeTotal === 0) {
    return {
      score: 50,
      level: HealthLevel.WATCH,
      weightsUsed: { ndvi: 0, ndre: 0, thermal: 0 },
      staleSignals,
      componentStress: {},
      triggeredAlert: false,
      alertThresholdUsed: 0,
    };
  }

  // Normalize weights
  const normalizedWeights = {};
  for (const name of signalNames) {
    normalizedWeights[name] = activeTotal > 0 ? activeWeights[name] / activeTotal : 0;
  }

  // Compute weighted stress
  const componentStress = {};
  let weightedStress = 0;
  for (const name of signalNames) {
    const stress = stressComponents[name] || 0;
    componentStress[name] = Math.round(stress * 1000) / 1000;
    weightedStress += normalizedWeights[name] * stress;
  }

  // Convert to health score (0-100, higher = healthier)
  const score = Math.max(0, Math.min(Math.round(100 * (1 - weightedStress)), 100));
  let level = healthLevelForScore(score);

  // Adaptive stress threshold
  const alertThreshold = getAlertThreshold(cropType, diseaseHypothesis);
  if (level === HealthLevel.WATCH && (1 - score / 100) >= alertThreshold) {
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

// ─── Core Risk Computation ────────────────────────────────────────────────

/**
 * Compute composite health score for a farm.
 *
 * Uses the vegetationHealth module for the core health score (NDVI + NDRE + CWSI).
 * Weather is still fetched for disease hypothesis detection only — it does NOT
 * contribute to the health score.
 *
 * Steps:
 * 1. Fetch fresh NDVI reading (Sentinel-2 or simulated)
 * 2. Fetch weather for disease hypothesis + CWSI computation
 * 3. Compute thermal reading (Landsat or formula)
 * 4. Compute health score via vegetationHealth module
 * 5. Field validity override (no vegetation detected)
 * 6. Spatial hotspot analysis
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
  let thermalReading = null;
  try {
    thermalReading = await computeThermalReading(farm, weatherEval.weatherReading || null);
  } catch (err) {
    console.warn('Thermal reading unavailable:', err.message);
  }

  // ── 3. Compute health score via vegetationHealth module ──
  const vegetationResult = await computeVegetationHealthScore(
    farm,
    weatherEval.weatherReading || null,
  );

  // ── 4. Field validity override ──
  const vegetationDetected = isVegetationDetected(
    ndviReading?.ndvi,
    ndviReading?.ndre,
    ndviReading?.sceneSource
  );
  if (!vegetationDetected) {
    vegetationResult.score = null;
    vegetationResult.level = null;
    vegetationResult.triggeredAlert = false;
  }

  // ── 5. Spatial Hotspot Analysis ──
  const spatialAnomaly = computeSpatialHotspot(
    ndviReading?.ndviGrid || null,
    ndviReading?.ndreGrid || null,
    thermalReading?.thermalGrid || null
  );

  // ── 6. Diagnostic: pest history (not in health score) ──
  const pestHistoryStress = await computePestHistoryComponent(farm);

  // ── 7. Save ──
  const riskScore = await RiskScore.create({
    farmId,
    computedAt: new Date(),
    weatherComponent: Math.round((weatherEval.score || 0) * 1000) / 1000,
    ndviComponent: vegetationResult.normalizedScores?.ndvi?.score != null
      ? Math.round((1 - vegetationResult.normalizedScores.ndvi.score / 100) * 1000) / 1000
      : 0.5,
    ndreComponent: vegetationResult.normalizedScores?.ndre?.score != null
      ? Math.round((1 - vegetationResult.normalizedScores.ndre.score / 100) * 1000) / 1000
      : 0.5,
    thermalComponent: vegetationResult.normalizedScores?.thermal?.cwsi != null
      ? Math.round(vegetationResult.normalizedScores.thermal.cwsi * 1000) / 1000
      : 0.5,
    pestHistoryComponent: Math.round(pestHistoryStress * 1000) / 1000,
    compositeScore: vegetationResult.score,
    triggeredAlert: vegetationResult.triggeredAlert,
    healthLevel: vegetationResult.level,
    staleSignals: vegetationResult.staleSignals || [],
    thresholdUsed: 0,
    diseaseHypothesis: weatherEval.diseaseHypothesis,
    matchedWeatherRules: weatherEval.matchedRules || [],
    weightsUsed: vegetationResult.weightsUsed,
    inputsSnapshot: {
      weatherReadingId: weatherEval.weatherReading?._id,
      ndviReadingId: ndviReading?._id,
      thermalReadingId: thermalReading?._id,
      weights: vegetationResult.weightsUsed,
      cropType: farm.cropType,
      cropStage: farm.cropStage,
      source: 'vegetationHealth',
      dataSources: {
        ndvi: ndviReading?.sceneSource || 'unknown',
        thermal: thermalReading?.sceneSource || 'unknown',
      },
      groundTruthVerified: ndviReading?.sceneSource === 'sentinel-2' || thermalReading?.sceneSource === 'landsat-8-9',
      noVegetationDetected: !vegetationDetected,
      spatialAnomaly,
      growthScenario: vegetationResult.growthScenario,
      effectiveStage: vegetationResult.effectiveStage || null,
      stageSource: vegetationResult.stageSource || null,
      baselineSource: vegetationResult.baselineSource,
      thermalConfidence: vegetationResult.thermalConfidence,
    },
  });

  // Update farm timestamps
  await Field.findByIdAndUpdate(farmId, { lastRiskScoreAt: new Date() });

  // Create notification when triggeredAlert is true
  if (vegetationResult.triggeredAlert && farm.userId) {
    try {
      await createNotification(farm.userId, 'weather_alert', {
        farmId: farm._id,
        deepLink: `/dashboard?farm=${farmId}`,
      });
    } catch (err) {
      console.warn('Failed to create weather_alert notification:', err.message);
    }
  }

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

// ─── Query Helpers ────────────────────────────────────────────────────────

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
