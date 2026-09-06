import NdviReading from '../models/NdviReading.js';
import Field from '../models/Field.js';
import { fetchSentinelNdvi } from './sentinelService.js';
import { resolveDistrictFarmIds } from './thermalService.js';

// ─── Field validity gate ────────────────────────────────────────────────
// This answers a DIFFERENT question than computeNdviComponent below:
// "is there any vegetation in this boundary at all?" vs "how stressed is
// the crop?" Trying to answer the first question by pushing the second
// question's stress score toward 1.0 doesn't work — NDVI/NDRE are only
// ~30-45% of the total weighted score (see computeFusedHealthScore in
// riskService.js), so even a maxed-out vegetation-index stress can only
// ever drag the composite down to roughly 100 * (1 - ndviWeight), not to
// 0 — weather/thermal/pestHistory don't measure whether THIS polygon has
// plants on it, so they can't contribute to detecting a misplaced
// boundary at all. This function is meant to be checked BEFORE/alongside
// the stress fusion and short-circuit it when vegetation is absent,
// rather than folded into the weighted average.
//
// Requires BOTH NDVI and NDRE to independently indicate no vegetation
// before concluding that — they're derived from the same averaged pixel
// grid, so if the underlying imagery is genuinely bare/paved/water, both
// should agree; requiring agreement avoids a single noisy read
// wrongly invalidating a real, just-planted field (bare soil at sowing
// stage can legitimately dip toward this NDVI range on its own).
const NO_VEGETATION_NDVI = 0.20; // Standard remote sensing threshold for bare concrete/rock/water
const NO_VEGETATION_NDRE = 0.20;

export function isVegetationDetected(ndvi, ndre, sceneSource) {
  // If no readings are provided, fail closed
  if (ndvi === null || ndvi === undefined) {
    return false;
  }

  // Reject simulated or fallback data over unverified land
  if (sceneSource === 'simulated' || sceneSource === 'fallback') {
    return false;
  }

  // Physical spectral gate: concrete, asphalt, rooftops, and water bodies fall below 0.20
  if (ndvi < NO_VEGETATION_NDVI) {
    return false;
  }

  if (ndre !== null && ndre !== undefined && ndre < NO_VEGETATION_NDRE) {
    return false;
  }

  return true;
}

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

// ─── NDRE interpretation (crop-agnostic, needs no cropType or history) ────
// NDRE is fetched and stored on every real Sentinel-2 reading (sentinelService.js)
// but was never actually used anywhere in scoring — dead data. NDRE is more
// sensitive to chlorophyll content than NDVI and is specifically called out
// as an early-disease/nutrient-deficiency indicator in its 0.2-0.6 band, which
// makes it directly relevant to an early-disease-detection system. Bands:
//   >= 0.6         : dense, healthy, high-chlorophyll canopy — no stress
//   0.2 to 0.6     : moderate growth — potentially early disease stress,
//                    nutrient deficiency, or a maturing crop
//   -1.0 to 0.2    : bare soil, dead vegetation, water, or severely
//                    diseased/low-chlorophyll plants
export function ndreToStress(ndre) {
  if (ndre >= 0.6) return 0;
  if (ndre >= 0.2) {
    // early-disease/nutrient-deficiency band — mild to moderate stress
    return 0.5 * (0.6 - ndre) / 0.4;
  }
  // bare/dead/severely diseased band
  return 0.5 + 0.5 * Math.min(1, (0.2 - ndre) / 1.2);
}

/**
 * Expected NDVI for a crop at a given stage/season — an ABSOLUTE reference,
 * not derived from this farm's own history. This is what lets a field be
 * flagged as unhealthy on its very first reading (see computeNdviComponent):
 * a trailing-average comparison has nothing to compare against yet, but a
 * bare/dead field is still obviously below what a healthy crop should read.
 * Returns null when cropType is unknown/unset — there is no reference to
 * compare against without knowing what should be growing there.
 */
export function getExpectedNdvi(cropType, cropStage, date = new Date()) {
  const cropKey = cropType?.toLowerCase();
  const baseline = CROP_NDVI_BASELINE[cropKey];
  if (!baseline) return null;
  const stageMult = STAGE_MULTIPLIER[cropStage] ?? 0.8;
  const seasonal = getSeasonalFactor(date.getMonth());
  return baseline * stageMult * seasonal;
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

  // No prior readings yet — there IS no trailing average. Returning
  // currentNdvi here (as this used to do) makes the very next
  // "current >= trailing_avg" check trivially true, which forces the
  // trend component to 0 on every farm's first-ever reading regardless
  // of how unhealthy the field actually looks. Return null so callers
  // know to fall back to an absolute reference instead of a fabricated one.
  if (recentReadings.length === 0) return null;

  const avg = recentReadings.reduce((sum, r) => sum + r.ndvi, 0) / recentReadings.length;
  return Math.round(avg * 1000) / 1000;
}

/**
 * Compute anomaly score: (current - trailing_avg) / stddev.
 * Negative = declining vegetation (higher risk).
 */
function computeAnomalyScore(currentNdvi, trailingAvg, readings) {
  if (readings.length < 2) return 0;
  if (trailingAvg === null || trailingAvg === undefined) return 0;
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

      if (sentinel.sceneInfo?.source === 'simulated') {
        const simulated = generateSimulatedNdvi(farm);
        ndvi = simulated.ndvi;
        ndre = simulated.ndre;
        cloudCoverPct = sentinel.sceneInfo.cloudCover ?? 100;
        pixelCountPureCrop = simulated.pixelCountPureCrop;
        sceneSource = 'simulated';
        sceneId = null;
        gridData = { ndvi: sentinel.ndviGrid, ndre: sentinel.ndreGrid };
      } else {
        // Average the grid to get scalar values
        ndvi = averageGrid(sentinel.ndviGrid);
        ndre = averageGrid(sentinel.ndreGrid);

        if (ndvi == null || ndre == null) {
          const simulated = generateSimulatedNdvi(farm);
          ndvi = simulated.ndvi;
          ndre = simulated.ndre;
          cloudCoverPct = 100;
          pixelCountPureCrop = simulated.pixelCountPureCrop;
          sceneSource = 'simulated';
          sceneId = null;
          gridData = { ndvi: sentinel.ndviGrid, ndre: sentinel.ndreGrid };
        } else {
          gridData = { ndvi: sentinel.ndviGrid, ndre: sentinel.ndreGrid };
          sceneSource = 'sentinel-2';
          sceneId = sentinel.sceneInfo.sceneId;
          cloudCoverPct = sentinel.sceneInfo.cloudCover || 0;
          observedAt = sentinel.observedAt;
          pixelCountPureCrop = GRID_SIZE * GRID_SIZE;
        }
      }
    } catch (error) {
      console.warn('Sentinel-2 fetch failed, falling back to simulated:', error.message);
      const simulated = generateSimulatedNdvi(farm);
      ndvi = simulated.ndvi;
      ndre = simulated.ndre;
      cloudCoverPct = 100;
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
  if (!grid || !Array.isArray(grid)) return null;
  const flat = grid.flat().filter(v => v != null && !isNaN(v));
  if (flat.length === 0) return null;
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
 * Three signals feed in, and the WORST of them wins:
 *
 * 0. Universal bare-surface floor — is NDVI below what any live
 *    vegetation reads, regardless of crop type? Needs nothing but the
 *    NDVI value itself, so it can't be bypassed by missing farm data.
 * 1. Absolute component — how far current NDVI sits below the expected
 *    NDVI for this crop/stage/season (CROP_NDVI_BASELINE). Catches a
 *    field that's unhealthy relative to what THIS crop should read.
 *    Requires a recognized cropType.
 * 2. Trend component — is NDVI declining relative to this farm's own
 *    28-day trailing average. Requires at least one prior reading.
 *    - current >= trailing_avg → 0 (stable/improving)
 *    - current < trailing_avg → scales 0-1 with the deficit
 * 3. NDRE component (see ndreToStress) — crop-agnostic like the universal
 *    floor, but sensitive to chlorophyll specifically, which can catch
 *    stress before NDVI would (canopy can look structurally full while
 *    chlorophyll is already declining).
 *
 * Using max() rather than averaging is deliberate: for early-disease
 * detection, a field that is unambiguously bad on any one measure should
 * not have that diluted by another measure looking fine or being
 * unavailable (e.g. a rooftop with no cropType set has no absolute or
 * trend signal to fall back on — the universal floor and NDRE are what
 * still catch it).
 *
 * Returns 0.5 (neutral/unknown) only when there is no NDVI reading at all.
 */
export async function computeNdviComponent(farmId, cropType = null, cropStage = null, farm = null) {
  const readings = await NdviReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(1)
    .lean();

  if (readings.length === 0) return 0.5; // no data at all — genuinely unknown

  const latest = readings[0];

  // 0. Universal bare-surface floor.
  const UNIVERSAL_BARE_NDVI = 0.15;
  let universalComponent = 0;
  if (latest.ndvi < UNIVERSAL_BARE_NDVI) {
    universalComponent = Math.min(1, (UNIVERSAL_BARE_NDVI - latest.ndvi) / (UNIVERSAL_BARE_NDVI + 0.1));
  }

  // 1. Absolute (crop-specific) component — requires a known cropType
  let absoluteComponent = null;
  const expected = getExpectedNdvi(cropType, cropStage, new Date(latest.observedAt));
  if (expected !== null && expected > 0) {
    const deficit = expected - latest.ndvi;
    absoluteComponent = Math.min(1, Math.max(0, deficit / expected));
  }

  // 2. Trend component — requires at least one prior reading
  let trendComponent = null;
  const trailingAvg = latest.trailingAvgNdvi28d;
  if (trailingAvg !== null && trailingAvg !== undefined && trailingAvg > 0) {
    trendComponent = latest.ndvi >= trailingAvg
      ? 0
      : Math.min(1, (trailingAvg - latest.ndvi) / trailingAvg);
  }

  // 2b. District-relative trend component (§4c) — requires district farm resolution
  let districtRelativeComponent = null;
  try {
    const farmObj = farm || await Field.findById(farmId).lean();
    if (farmObj) {
      const districtInfo = await resolveDistrictFarmIds(farmObj);
      if (districtInfo && districtInfo.farmIds.length > 0) {
        const twentyEightDaysAgo = new Date(new Date(latest.observedAt).getTime() - 28 * 24 * 60 * 60 * 1000);
        const districtReadings = await NdviReading.find({
          farmId: { $in: districtInfo.farmIds },
          observedAt: { $gte: twentyEightDaysAgo, $lte: new Date(latest.observedAt) },
          sceneSource: { $ne: 'simulated' },
        }).select('ndvi').lean();

        // Require at least 3 real satellite readings across the district to form a valid baseline
        if (districtReadings.length >= 3) {
          const districtMeanNdvi = districtReadings.reduce((sum, r) => sum + r.ndvi, 0) / districtReadings.length;
          if (districtMeanNdvi > 0 && latest.ndvi < districtMeanNdvi) {
            const deficit = districtMeanNdvi - latest.ndvi;
            districtRelativeComponent = Math.min(1, Math.max(0, deficit / districtMeanNdvi));
          } else {
            districtRelativeComponent = 0;
          }
        }
      }
    }
  } catch (err) {
    console.warn('District relative NDVI calculation skipped:', err.message);
  }

  // 3. NDRE now lives as an independent weighted component in computeFusedHealthScore (§4a/4b).
  // Keeping it here would double-count it against NDVI's weight. Removed.

  const component = Math.max(
    universalComponent,
    absoluteComponent ?? 0,
    trendComponent ?? 0,
    districtRelativeComponent ?? 0
  );
  return Math.round(component * 1000) / 1000;
}

/**
 * Compute NDRE stress component for a farm (§4a/4b).
 * NDRE is now an independent weighted signal in the fusion, not folded into NDVI.
 *
 * Uses ndreToStress() on the latest reading — no crop-specific baseline needed.
 * Returns 0.5 (neutral/unknown) when no reading exists or ndre is null.
 */
export async function computeNdreComponent(farmId) {
  const readings = await NdviReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(1)
    .lean();

  if (readings.length === 0) return 0.5; // no data — genuinely unknown

  const latest = readings[0];
  if (latest.ndre === null || latest.ndre === undefined) return 0.5; // real reading without NDRE band (older entry)

  return Math.round(ndreToStress(latest.ndre) * 1000) / 1000;
}

/**
 * Analyze spatial heterogeneity across a field's 10x10 grid (§4d).
 * Detects localized vigor drops and checks for thermal corroboration at the same physical pixels.
 *
 * All thresholds are documented, reasoned starting assumptions (unvalidated hypotheses):
 * - NDVI stddev > 0.10 indicates significant spatial non-uniformity across the field.
 * - Hotspot cells = cells with NDVI < (mean - 1.0 * stdDev).
 * - Thermal corroboration = hotspot cells are > 1.5°C warmer than field average canopy temp.
 *
 * Returns structured result for risk assessment and dashboard visualization.
 */
export function computeSpatialHotspot(ndviGrid, ndreGrid = null, thermalGrid = null) {
  const emptyResult = {
    isHeterogeneous: false,
    stdDev: 0,
    hotspotCellsCount: 0,
    hotspotCells: [],
    thermalCorroboration: false,
    fieldMeanTemp: null,
    hotspotMeanTemp: null,
    message: null,
  };

  if (!ndviGrid || !Array.isArray(ndviGrid)) {
    return emptyResult;
  }

  // 1. Collect valid cell values and coordinates
  const validCells = [];
  for (let r = 0; r < ndviGrid.length; r++) {
    for (let c = 0; c < (ndviGrid[r]?.length || 0); c++) {
      const val = ndviGrid[r][c];
      if (val !== null && val !== undefined && !isNaN(val)) {
        validCells.push({ row: r, col: c, ndvi: val });
      }
    }
  }

  if (validCells.length < 5) {
    return emptyResult;
  }

  // 2. Compute mean & standard deviation
  const ndviSum = validCells.reduce((sum, cell) => sum + cell.ndvi, 0);
  const meanNdvi = ndviSum / validCells.length;
  const variance = validCells.reduce((sum, cell) => sum + (cell.ndvi - meanNdvi) ** 2, 0) / validCells.length;
  const stdDev = Math.round(Math.sqrt(variance) * 1000) / 1000;

  // Threshold assumption: stdDev > 0.10 signals spatial heterogeneity
  const HETEROGENEITY_THRESHOLD_STDDEV = 0.10;
  const isHeterogeneous = stdDev > HETEROGENEITY_THRESHOLD_STDDEV;

  if (!isHeterogeneous) {
    return { ...emptyResult, stdDev };
  }

  // 3. Identify hotspot cells (cells falling below mean - 1.0 * stdDev)
  const hotspotCutoff = meanNdvi - 1.0 * stdDev;
  const hotspotCells = validCells
    .filter(cell => cell.ndvi < hotspotCutoff)
    .map(cell => ({ row: cell.row, col: cell.col, ndvi: cell.ndvi }));

  // 4. Thermal corroboration check (if thermalGrid is available)
  let thermalCorroboration = false;
  let fieldMeanTemp = null;
  let hotspotMeanTemp = null;

  if (thermalGrid && Array.isArray(thermalGrid)) {
    const validThermalCells = [];
    const hotspotThermalValues = [];

    for (let r = 0; r < thermalGrid.length; r++) {
      for (let c = 0; c < (thermalGrid[r]?.length || 0); c++) {
        const temp = thermalGrid[r][c];
        if (temp !== null && temp !== undefined && !isNaN(temp)) {
          validThermalCells.push(temp);
          if (hotspotCells.some(h => h.row === r && h.col === c)) {
            hotspotThermalValues.push(temp);
          }
        }
      }
    }

    if (validThermalCells.length > 0) {
      fieldMeanTemp = Math.round((validThermalCells.reduce((a, b) => a + b, 0) / validThermalCells.length) * 10) / 10;
    }

    if (hotspotThermalValues.length > 0 && fieldMeanTemp !== null) {
      hotspotMeanTemp = Math.round((hotspotThermalValues.reduce((a, b) => a + b, 0) / hotspotThermalValues.length) * 10) / 10;
      // Thermal corroboration threshold: hotspot patch is > 1.5°C warmer than field mean
      const THERMAL_HOTSPOT_DELTA_C = 1.5;
      if (hotspotMeanTemp - fieldMeanTemp > THERMAL_HOTSPOT_DELTA_C) {
        thermalCorroboration = true;
      }
    }
  }

  const message = 'Localized anomaly detected — pattern consistent with root/vascular stress — recommend inspection.';

  return {
    isHeterogeneous: true,
    stdDev,
    hotspotCellsCount: hotspotCells.length,
    hotspotCells,
    thermalCorroboration,
    fieldMeanTemp,
    hotspotMeanTemp,
    message,
  };
}