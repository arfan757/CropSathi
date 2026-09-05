import ThermalReading from '../models/ThermalReading.js';
import Field from '../models/Field.js';
import User from '../models/User.js';
import { fetchLandsatLst } from './landsatService.js';

// ─── Per-crop thermal constants (spec §7.3) ───────────────────────────────
// estimated_canopy_temp = air_temp + crop_offset - (humidity - 50) * humidity_coefficient
const CROP_CONSTANTS = {
  cotton:   { offsetC: 3.5, humidityCoeff: 0.12 },
  soybean:  { offsetC: 3.0, humidityCoeff: 0.10 },
  tur:      { offsetC: 2.8, humidityCoeff: 0.09 },
  wheat:    { offsetC: 2.0, humidityCoeff: 0.08 },
  rice:     { offsetC: 4.0, humidityCoeff: 0.14 },
  maize:    { offsetC: 3.2, humidityCoeff: 0.11 },
  sugarcane:{ offsetC: 3.8, humidityCoeff: 0.13 },
  potato:   { offsetC: 2.5, humidityCoeff: 0.09 },
  grapes:   { offsetC: 2.2, humidityCoeff: 0.08 },
};

const DEFAULT_CONSTANTS = { offsetC: 3.0, humidityCoeff: 0.10 };

// ─── Estimation Formula ────────────────────────────────────────────────────

/**
 * Estimate canopy temperature from weather data.
 * Formula (spec §7.3): estimated_canopy_temp_c = air_temp_c + crop_offset_c
 *   - (humidity_pct - 50) * humidity_coefficient
 *
 * High humidity → lower canopy temp (evaporative cooling).
 * Crop offset accounts for canopy density and transpiration differences.
 */
function estimateCanopyTemp(airTempC, humidityPct, cropType) {
  const cropKey = cropType?.toLowerCase();
  const constants = CROP_CONSTANTS[cropKey] || DEFAULT_CONSTANTS;

  const estimated = airTempC + constants.offsetC - (humidityPct - 50) * constants.humidityCoeff;
  return Math.round(estimated * 100) / 100;
}

// ─── District Baseline ─────────────────────────────────────────────────────

/**
 * Resolve the active field ids belonging to the farm owner's district.
 *
 * District is stored on the owning User (farmDetails.district), NOT on
 * the Field model — earlier code queried Field by farmDetails.district,
 * which never matched anything, silently degrading the "district-level"
 * baseline to a per-farm one.
 *
 * @returns {Promise<{district: string, farmIds: Array}|null>} null when no district is known
 */
export async function resolveDistrictFarmIds(farm) {
  if (!farm) return null;

  if (!farm.userId) {
    // Without userId there's no way to look up the owner's district, and
    // this degrades silently to the farm-trailing baseline below with no
    // signal that district-level comparison never actually ran. Most
    // often this means the caller fetched `farm` with a projection that
    // dropped userId — worth checking if district baselines seem to
    // never kick in for a farm that should have district neighbors.
    console.warn(`resolveDistrictFarmIds: farm ${farm._id} has no userId — cannot resolve district`);
  }

  const owner = farm.userId
    ? await User.findById(farm.userId).select('farmDetails.district').lean()
    : null;
  const district = farm.farmDetails?.district || owner?.farmDetails?.district;
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
  }).select('_id').lean();

  return { district, farmIds: districtFields.map(f => f._id) };
}

/**
 * Compute rolling 14-day district baseline of estimated canopy temperature.
 * Average across all farms in the same district (spec §7.3: "district-level, not farm-level").
 *
 * If no district data exists, falls back to the farm's own trailing average.
 */
async function getDistrictBaseline(farm, trailingDays = 14) {
  const info = await resolveDistrictFarmIds(farm);
  if (!info || info.farmIds.length === 0) return null;

  const cutoff = new Date(Date.now() - trailingDays * 24 * 60 * 60 * 1000);

  const readings = await ThermalReading.find({
    farmId: { $in: info.farmIds },
    observedAt: { $gte: cutoff },
  }).select('estimatedCanopyTempC').lean();

  if (readings.length === 0) return null;

  const avg = readings.reduce((sum, r) => sum + r.estimatedCanopyTempC, 0) / readings.length;
  return Math.round(avg * 100) / 100;
}

/**
 * Get farm's own trailing average as fallback when no district data.
 */
async function getFarmTrailingBaseline(farmId, trailingDays = 14) {
  const cutoff = new Date(Date.now() - trailingDays * 24 * 60 * 60 * 1000);

  const readings = await ThermalReading.find({
    farmId,
    observedAt: { $gte: cutoff },
  }).select('estimatedCanopyTempC').lean();

  if (readings.length === 0) return null;

  const avg = readings.reduce((sum, r) => sum + r.estimatedCanopyTempC, 0) / readings.length;
  return Math.round(avg * 100) / 100;
}

// ─── Thermal Reading Creation ──────────────────────────────────────────────

/**
 * Compute a thermal reading for a farm.
 * Tries real Landsat LST first; falls back to formula-based estimation.
 */
export async function computeThermalReading(farm, weatherReading) {
  const hasCopernicusCredentials = process.env.COPERNICUS_CLIENT_ID && process.env.COPERNICUS_CLIENT_SECRET;

  // Try real Landsat LST first
  if (hasCopernicusCredentials) {
    try {
      const landsat = await fetchLandsatLst(farm);

      // fetchLandsatLst silently returns a SIMULATED grid (random noise
      // around 32°C) when the Copernicus API call fails (auth, rate limit,
      // no scene in the time window, empty response). That fallback is
      // labeled sceneInfo.source === 'formula' / sceneName 'Simulated' /
      // sceneId null — never store it as if it were real Landsat data, or
      // the app serves fabricated readings labeled "Landsat 8/9". Throw so
      // the catch below falls through to the honest formula path instead.
      if (landsat.sceneInfo?.source !== 'landsat-8-9' || !landsat.sceneInfo?.sceneId) {
        throw new Error('Landsat returned a simulated fallback grid, not real data');
      }

      // Average the grid for the scalar value
      const avgLst = averageGrid(landsat.thermalGrid);

      // Compute baseline (district-level, falls back to farm trailing avg)
      let baseline = await getDistrictBaseline(farm);
      if (baseline === null) {
        baseline = await getFarmTrailingBaseline(farm._id);
      }
      // Cold start: no district or farm history yet, so there is nothing
      // to compare the measured temperature against and anomalyC would
      // silently default to 0 (no stress) below. Fall back to a
      // weather-derived expected canopy temp — an independent, absolute
      // reference — so a real satellite reading can still be flagged as
      // anomalous on a farm's very first thermal reading.
      if (baseline === null && weatherReading) {
        baseline = estimateCanopyTemp(weatherReading.temperatureC, weatherReading.humidityPct, farm.cropType);
      }

      const anomalyC = baseline !== null
        ? Math.round((avgLst - baseline) * 100) / 100
        : 0;

      const reading = await ThermalReading.create({
        farmId: farm._id,
        observedAt: landsat.observedAt,
        estimatedCanopyTempC: avgLst,
        baselineTempC: baseline,
        anomalyC,
        resolution: 'landsat-8-9',
        thermalGrid: landsat.thermalGrid,
        sceneSource: 'landsat-8-9',
        sceneId: landsat.sceneInfo.sceneId,
      });

      return reading;
    } catch (error) {
      console.warn('Landsat LST fetch failed, falling back to formula:', error.message);
    }
  }

  // Fallback: formula-based estimation
  if (!weatherReading) {
    throw new Error('Weather reading required for thermal estimation (no Landsat data available)');
  }

  const estimated = estimateCanopyTemp(
    weatherReading.temperatureC,
    weatherReading.humidityPct,
    farm.cropType,
  );

  // Baseline is district-level (spec §7.3); falls back to farm's own history.
  // NOTE: unlike the Landsat branch, there is no independent absolute
  // fallback available here on cold start — `estimated` IS the formula
  // applied to today's weather, so comparing it to itself would be
  // circular. A farm's very first thermal reading, when no real Landsat
  // data is available, genuinely cannot detect a thermal anomaly; this is
  // a data limitation (no ground-truth canopy measurement), not something
  // this function can paper over. It resolves once either district data
  // accumulates or Landsat/Copernicus access is available.
  let baseline = await getDistrictBaseline(farm);
  if (baseline === null) {
    baseline = await getFarmTrailingBaseline(farm._id);
  }

  const anomalyC = baseline !== null
    ? Math.round((estimated - baseline) * 100) / 100
    : 0;

  const reading = await ThermalReading.create({
    farmId: farm._id,
    observedAt: new Date(),
    estimatedCanopyTempC: estimated,
    baselineTempC: baseline,
    anomalyC,
    resolution: baseline !== null ? 'district' : 'farm_simulated',
    sceneSource: 'formula',
  });

  return reading;
}

// Helper to average a 10x10 grid
const GRID_SIZE = 10;
function averageGrid(grid) {
  if (!grid || !Array.isArray(grid)) return 30;
  const flat = grid.flat().filter(v => v != null && !isNaN(v));
  if (flat.length === 0) return 30;
  return Math.round((flat.reduce((s, v) => s + v, 0) / flat.length) * 100) / 100;
}

/**
 * Get recent thermal readings for a farm.
 */
export async function getRecentThermal(farmId, limit = 10) {
  return ThermalReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Compute thermal risk component for a farm.
 *
 * Logic: positive anomaly (canopy hotter than baseline) = stress = risk.
 * - anomaly <= 0 → score = 0 (no thermal stress)
 * - anomaly > 0 → scales from 0 to 1
 * - 10°C anomaly = maximum risk (score = 1)
 *
 * Formula: thermal_component = min(1, max(0, anomaly_c / 10))
 */
export async function computeThermalComponent(farmId) {
  const readings = await ThermalReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(1)
    .lean();

  if (readings.length === 0) return 0.5; // neutral if no data

  const latest = readings[0];

  if (latest.anomalyC <= 0) return 0;

  const component = Math.min(1, latest.anomalyC / 10);
  return Math.round(component * 1000) / 1000;
}