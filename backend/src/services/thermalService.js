import ThermalReading from '../models/ThermalReading.js';
import Field from '../models/Field.js';
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
 * Compute rolling 14-day district baseline of estimated canopy temperature.
 * Average across all farms in the same district (spec §7.3: "district-level, not farm-level").
 *
 * If no district data exists, falls back to the farm's own trailing average.
 */
async function getDistrictBaseline(district, trailingDays = 14) {
  if (!district) return null;

  const cutoff = new Date(Date.now() - trailingDays * 24 * 60 * 60 * 1000);

  // Find all farms in this district
  const farmsInDistrict = await Field.find({
    'farmDetails.district': district,
    status: 'active',
  }).select('_id').lean();

  if (farmsInDistrict.length === 0) return null;

  const farmIds = farmsInDistrict.map(f => f._id);

  const readings = await ThermalReading.find({
    farmId: { $in: farmIds },
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

      // Average the grid for the scalar value
      const avgLst = averageGrid(landsat.thermalGrid);

      // Compute baseline
      const district = farm.farmDetails?.district;
      let baseline = await getDistrictBaseline(district);
      if (baseline === null) {
        baseline = await getFarmTrailingBaseline(farm._id);
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

  const district = farm.farmDetails?.district;
  let baseline = await getDistrictBaseline(district);
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
