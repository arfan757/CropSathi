import NdviReading from '../models/NdviReading.js';
import Field from '../models/Field.js';
import { fetchSentinelNdvi } from './sentinelService.js';

// ─── Crop-specific NDVI baselines (typical peak-season values) ─────────────
const CROP_NDVI_BASELINE = {
  cotton: 0.60,
  soybean: 0.65,
  tur: 0.55,
  wheat: 0.55,
  rice: 0.70,
  maize: 0.62,
  sugarcane: 0.72,
  potato: 0.50,
  grapes: 0.45,
};

// Crop stage adjustments (multiplier applied to baseline)
const STAGE_MULTIPLIER = {
  sowing: 0.3,
  vegetative: 1.0,
  flowering: 0.95,
  fruiting: 0.85,
  maturity: 0.7,
  harvested: 0.2,
};

// Seasonal modulation by month (India: monsoon Jun-Sep = higher NDVI)
function getSeasonalFactor(month) {
  // month is 0-indexed
  const factors = [0.7, 0.7, 0.8, 0.85, 0.9, 1.0, 1.0, 1.0, 0.95, 0.85, 0.75, 0.7];
  return factors[month];
}

/**
 * Generate a realistic simulated NDVI reading for a farm.
 * In production, this would query Google Earth Engine for Sentinel-2 imagery.
 * The simulation produces values consistent with crop type, stage, and season.
 */
function generateSimulatedNdvi(farm) {
  const cropKey = farm.cropType?.toLowerCase() || 'other';
  const baseline = CROP_NDVI_BASELINE[cropKey] || 0.55;
  const stageMult = STAGE_MULTIPLIER[farm.cropStage] || 0.8;
  const month = new Date().getMonth();
  const seasonal = getSeasonalFactor(month);

  // Base NDVI = baseline * stage * seasonal + noise
  const noise = (Math.random() - 0.5) * 0.08;
  let ndvi = baseline * stageMult * seasonal + noise;

  // 10% chance of anomaly injection (depressed NDVI)
  if (Math.random() < 0.10) {
    ndvi -= 0.15 + Math.random() * 0.15;
  }

  ndvi = Math.max(-0.1, Math.min(0.95, ndvi));

  // NDRE is typically ~0.7 * NDVI for healthy vegetation
  const ndre = ndvi * (0.65 + Math.random() * 0.1);

  // Cloud cover — most readings clear, some cloudy
  const cloudCoverPct = Math.random() < 0.85 ? Math.random() * 20 : 20 + Math.random() * 40;

  // Simulated pixel count (larger farms = more pixels)
  const areaHa = farm.areaInHectares || 1;
  const pixelCountPureCrop = Math.round(areaHa * 100 + Math.random() * 50);

  return {
    ndvi: Math.round(ndvi * 1000) / 1000,
    ndre: Math.round(ndre * 1000) / 1000,
    cloudCoverPct: Math.round(cloudCoverPct * 10) / 10,
    pixelCountPureCrop,
  };
}

/**
 * Compute trailing 28-day average NDVI for a farm.
 */
async function computeTrailingAvg(farmId, currentNdvi, observedAt) {
  const twentyEightDaysAgo = new Date(observedAt.getTime() - 28 * 24 * 60 * 60 * 1000);

  const recentReadings = await NdviReading.find({
    farmId,
    observedAt: { $gte: twentyEightDaysAgo, $lt: observedAt },
    cloudCoverPct: { $lt: 40 }, // exclude cloudy scenes
  })
    .sort({ observedAt: -1 })
    .limit(10)
    .lean();

  if (recentReadings.length === 0) return currentNdvi;

  const avg = recentReadings.reduce((sum, r) => sum + r.ndvi, 0) / recentReadings.length;
  return Math.round(avg * 1000) / 1000;
}

/**
 * Compute anomaly score: (current - trailing_avg) / stddev.
 * Negative = declining vegetation (higher risk).
 */
function computeAnomalyScore(currentNdvi, trailingAvg, readings) {
  if (readings.length < 2) return 0;
  const mean = readings.reduce((s, r) => s + r.ndvi, 0) / readings.length;
  const variance = readings.reduce((s, r) => s + (r.ndvi - mean) ** 2, 0) / readings.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 0;
  return Math.round(((currentNdvi - trailingAvg) / stddev) * 100) / 100;
}

/**
 * Fetch/store NDVI reading for a farm.
 * Tries real Sentinel-2 data first; falls back to simulated if credentials missing or API fails.
 */
export async function fetchNdviForFarm(farm) {
  const now = new Date();

  // Try real Sentinel-2 data first
  let ndvi, ndre, gridData = null, sceneSource = 'simulated', sceneId = null;
  let observedAt = now;
  let cloudCoverPct = 0;
  let pixelCountPureCrop = null;

  const hasCopernicusCredentials = process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET;

  if (hasCopernicusCredentials) {
    try {
      const sentinel = await fetchSentinelNdvi(farm);

      // Average the grid to get scalar values
      ndvi = averageGrid(sentinel.ndviGrid);
      ndre = averageGrid(sentinel.ndreGrid);
      gridData = { ndvi: sentinel.ndviGrid, ndre: sentinel.ndreGrid };
      sceneSource = 'sentinel-2';
      sceneId = sentinel.sceneInfo.sceneId;
      cloudCoverPct = sentinel.sceneInfo.cloudCover || 0;
      observedAt = sentinel.observedAt;

      // Estimate pixel count from grid dimensions
      pixelCountPureCrop = GRID_SIZE * GRID_SIZE;
    } catch (error) {
      console.warn('Sentinel-2 fetch failed, falling back to simulated:', error.message);
      const simulated = generateSimulatedNdvi(farm);
      ndvi = simulated.ndvi;
      ndre = simulated.ndre;
      cloudCoverPct = simulated.cloudCoverPct;
      pixelCountPureCrop = simulated.pixelCountPureCrop;
    }
  } else {
    const simulated = generateSimulatedNdvi(farm);
    ndvi = simulated.ndvi;
    ndre = simulated.ndre;
    cloudCoverPct = simulated.cloudCoverPct;
    pixelCountPureCrop = simulated.pixelCountPureCrop;
  }

  const trailingAvg = await computeTrailingAvg(farm._id, ndvi, observedAt);

  // Get recent readings for stddev
  const recentForStd = await NdviReading.find({ farmId: farm._id })
    .sort({ observedAt: -1 })
    .limit(10)
    .lean();

  const anomalyScore = computeAnomalyScore(ndvi, trailingAvg, recentForStd);

  const reading = await NdviReading.create({
    farmId: farm._id,
    observedAt,
    ndvi,
    ndre,
    cloudCoverPct,
    trailingAvgNdvi28d: trailingAvg,
    anomalyScore,
    pixelCountPureCrop,
    ndviGrid: gridData?.ndvi || null,
    ndreGrid: gridData?.ndre || null,
    sceneSource,
    sceneId,
  });

  return reading;
}

// Helper to average a 10x10 grid into a single value
const GRID_SIZE = 10;
function averageGrid(grid) {
  if (!grid || !Array.isArray(grid)) return 0.5;
  const flat = grid.flat().filter(v => v != null && !isNaN(v));
  if (flat.length === 0) return 0.5;
  return Math.round((flat.reduce((s, v) => s + v, 0) / flat.length) * 1000) / 1000;
}

/**
 * Get recent NDVI readings for a farm.
 */
export async function getRecentNdvi(farmId, limit = 10) {
  return NdviReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Compute NDVI risk component for a farm.
 *
 * Logic: if current NDVI is below trailing average, risk increases.
 * - current >= trailing_avg → score = 0 (improving/stable = no risk)
 * - current < trailing_avg → score scales from 0 to 1 based on deficit
 *
 * Formula: ndvi_component = min(1, max(0, (trailing_avg - current) / trailing_avg))
 * Floored at 0 when NDVI is at/above baseline (improving = no risk per spec §7.2).
 */
export async function computeNdviComponent(farmId) {
  const readings = await NdviReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(1)
    .lean();

  if (readings.length === 0) return 0.5; // neutral if no data

  const latest = readings[0];
  const trailingAvg = latest.trailingAvgNdvi28d;

  if (!trailingAvg || trailingAvg <= 0) return 0.5;

  // If current >= trailing avg → no risk (improving or stable)
  if (latest.ndvi >= trailingAvg) return 0;

  // Risk scales with deficit
  const deficit = trailingAvg - latest.ndvi;
  const component = Math.min(1, deficit / trailingAvg);

  return Math.round(component * 1000) / 1000;
}
