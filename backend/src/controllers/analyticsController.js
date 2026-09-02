import Field from '../models/Field.js';
import NdviReading from '../models/NdviReading.js';
import ThermalReading from '../models/ThermalReading.js';
import RiskScore from '../models/RiskScore.js';
import WeatherReading from '../models/WeatherReading.js';
import { fetchNdviForFarm, getRecentNdvi } from '../services/ndviService.js';
import { computeThermalReading, getRecentThermal } from '../services/thermalService.js';
import { classifyNdvi, classifyNdre, computeGridDelta } from '../services/sentinelService.js';
import { classifyThermal, computeThermalAnomaly } from '../services/landsatService.js';

// ─── Helper: verify farm ownership ────────────────────────────────────────

async function verifyFarm(req) {
  const farm = await Field.findOne({ _id: req.params.farmId, userId: req.user.id });
  if (!farm) throw new Error('FARM_NOT_FOUND');
  return farm;
}

// ─── Auto-fetch: ensure satellite data exists for a farm ──────────────────

/**
 * Ensure NDVI grid data exists for a farm. Fetches from satellite if missing.
 * Returns the latest NdviReading document (with ndviGrid populated).
 */
async function ensureNdviData(farmId, forceRefresh = false) {
  if (!forceRefresh) {
    const latest = await NdviReading.findOne({ farmId, ndviGrid: { $ne: null } })
      .sort({ observedAt: -1 })
      .lean();
    if (latest) return latest;
  }

  // No grid data exists (or force refresh) — fetch from satellite
  const farm = await Field.findById(farmId).lean();
  if (!farm) return null;

  try {
    const reading = await fetchNdviForFarm(farm);
    // Re-read to get the full document with grid
    return await NdviReading.findById(reading._id).lean();
  } catch (err) {
    console.warn('Auto-fetch NDVI failed:', err.message);
    return null;
  }
}

/**
 * Ensure thermal grid data exists for a farm. Fetches from satellite if missing.
 */
async function ensureThermalData(farmId, forceRefresh = false) {
  if (!forceRefresh) {
    const latest = await ThermalReading.findOne({ farmId, thermalGrid: { $ne: null } })
      .sort({ observedAt: -1 })
      .lean();
    if (latest) return latest;
  }

  const farm = await Field.findById(farmId).lean();
  if (!farm) return null;

  try {
    const latestWeather = await WeatherReading.findOne({ farmId })
      .sort({ observedAt: -1 })
      .lean();
    const reading = await computeThermalReading(farm, latestWeather);
    return await ThermalReading.findById(reading._id).lean();
  } catch (err) {
    console.warn('Auto-fetch thermal failed:', err.message);
    return null;
  }
}

// ─── NDVI Grid Endpoint ───────────────────────────────────────────────────

/**
 * GET /api/analytics/farms/:farmId/ndvi-grid
 * Returns the latest 10x10 NDVI grid. Auto-fetches from satellite if no data exists.
 */
export async function getNdviGridEndpoint(req, res) {
  try {
    const farm = await verifyFarm(req);
    const force = req.query.force === 'true';

    const latest = await ensureNdviData(farm._id, force);

    if (!latest || !latest.ndviGrid) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No NDVI data available for this farm.',
      });
    }

    const previous = await NdviReading.findOne({
      farmId: farm._id,
      _id: { $ne: latest._id },
      ndviGrid: { $ne: null },
    })
      .sort({ observedAt: -1 })
      .lean();

    const classifiedGrid = latest.ndviGrid.map(row =>
      row.map(val => ({ value: val, ...classifyNdvi(val) }))
    );

    const deltaGrid = previous?.ndviGrid
      ? computeGridDelta(latest.ndviGrid, previous.ndviGrid)
      : null;

    res.status(200).json({
      success: true,
      data: {
        grid: classifiedGrid,
        delta: deltaGrid,
        average: latest.ndvi,
        trailingAvg: latest.trailingAvgNdvi28d,
        anomalyScore: latest.anomalyScore,
        observedAt: latest.observedAt,
        sceneSource: latest.sceneSource,
        previousDate: previous?.observedAt || null,
      },
    });
  } catch (error) {
    if (error.message === 'FARM_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── NDRE Grid Endpoint ───────────────────────────────────────────────────

/**
 * GET /api/analytics/farms/:farmId/ndre-grid
 * Returns the latest 10x10 NDRE grid. Auto-fetches if no data exists.
 */
export async function getNdreGridEndpoint(req, res) {
  try {
    const farm = await verifyFarm(req);
    const force = req.query.force === 'true';

    const latest = await ensureNdviData(farm._id, force);

    if (!latest || !latest.ndreGrid) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No NDRE data available for this farm.',
      });
    }

    const previous = await NdviReading.findOne({
      farmId: farm._id,
      _id: { $ne: latest._id },
      ndreGrid: { $ne: null },
    })
      .sort({ observedAt: -1 })
      .lean();

    const classifiedGrid = latest.ndreGrid.map(row =>
      row.map(val => ({ value: val, ...classifyNdre(val) }))
    );

    const deltaGrid = previous?.ndreGrid
      ? computeGridDelta(latest.ndreGrid, previous.ndreGrid)
      : null;

    const flat = latest.ndreGrid.flat().filter(v => v != null);
    const avgNdre = flat.length > 0
      ? Math.round((flat.reduce((s, v) => s + v, 0) / flat.length) * 1000) / 1000
      : 0;

    res.status(200).json({
      success: true,
      data: {
        grid: classifiedGrid,
        delta: deltaGrid,
        average: avgNdre,
        observedAt: latest.observedAt,
        sceneSource: latest.sceneSource,
        previousDate: previous?.observedAt || null,
      },
    });
  } catch (error) {
    if (error.message === 'FARM_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Thermal Grid Endpoint ────────────────────────────────────────────────

/**
 * GET /api/analytics/farms/:farmId/thermal-grid
 * Returns the latest 10x10 thermal grid. Auto-fetches if no data exists.
 */
export async function getThermalGridEndpoint(req, res) {
  try {
    const farm = await verifyFarm(req);
    const force = req.query.force === 'true';

    const latest = await ensureThermalData(farm._id, force);

    if (!latest || !latest.thermalGrid) {
      return res.status(200).json({
        success: true,
        data: null,
        message: 'No thermal data available for this farm.',
      });
    }

    const previous = await ThermalReading.findOne({
      farmId: farm._id,
      _id: { $ne: latest._id },
      thermalGrid: { $ne: null },
    })
      .sort({ observedAt: -1 })
      .lean();

    const baseline = latest.baselineTempC || 30;
    const classifiedGrid = latest.thermalGrid.map(row =>
      row.map(val => ({
        value: val,
        anomaly: Math.round((val - baseline) * 100) / 100,
        ...classifyThermal(val, baseline),
      }))
    );

    const deltaGrid = previous?.thermalGrid
      ? computeThermalAnomaly(latest.thermalGrid, baseline)
      : null;

    res.status(200).json({
      success: true,
      data: {
        grid: classifiedGrid,
        delta: deltaGrid,
        average: latest.estimatedCanopyTempC,
        baseline: latest.baselineTempC,
        anomalyC: latest.anomalyC,
        observedAt: latest.observedAt,
        sceneSource: latest.sceneSource,
        resolution: latest.resolution,
        previousDate: previous?.observedAt || null,
      },
    });
  } catch (error) {
    if (error.message === 'FARM_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Timeseries Endpoint ──────────────────────────────────────────────────

/**
 * GET /api/analytics/farms/:farmId/timeseries
 * Returns NDVI, NDRE, and thermal values over time for trend visualization.
 */
export async function getTimeseriesEndpoint(req, res) {
  try {
    const farm = await verifyFarm(req);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    const ndviReadings = await NdviReading.find({ farmId: farm._id })
      .sort({ observedAt: -1 })
      .limit(limit)
      .select('observedAt ndvi ndre anomalyScore trailingAvgNdvi28d sceneSource')
      .lean();

    const thermalReadings = await ThermalReading.find({ farmId: farm._id })
      .sort({ observedAt: -1 })
      .limit(limit)
      .select('observedAt estimatedCanopyTempC baselineTempC anomalyC sceneSource')
      .lean();

    const riskScores = await RiskScore.find({ farmId: farm._id })
      .sort({ computedAt: -1 })
      .limit(limit)
      .select('computedAt compositeScore weatherComponent ndviComponent thermalComponent triggeredAlert')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        ndvi: ndviReadings.map(r => ({
          date: r.observedAt,
          ndvi: r.ndvi,
          ndre: r.ndre,
          anomaly: r.anomalyScore,
          trailingAvg: r.trailingAvgNdvi28d,
          source: r.sceneSource,
        })),
        thermal: thermalReadings.map(r => ({
          date: r.observedAt,
          lst: r.estimatedCanopyTempC,
          baseline: r.baselineTempC,
          anomaly: r.anomalyC,
          source: r.sceneSource,
        })),
        risk: riskScores.map(r => ({
          date: r.computedAt,
          composite: r.compositeScore,
          weather: r.weatherComponent,
          ndvi: r.ndviComponent,
          thermal: r.thermalComponent,
          alert: r.triggeredAlert,
        })),
      },
    });
  } catch (error) {
    if (error.message === 'FARM_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Poll Satellite Endpoint (Force Re-analyse) ───────────────────────────

/**
 * POST /api/analytics/farms/:farmId/poll-satellite
 * Force re-fetch satellite data regardless of cache.
 */
export async function pollSatelliteEndpoint(req, res) {
  try {
    const farm = await verifyFarm(req);

    // Force fetch NDVI
    const ndviReading = await fetchNdviForFarm(farm);

    // Force fetch thermal
    let thermalReading = null;
    try {
      const latestWeather = await WeatherReading.findOne({ farmId: farm._id })
        .sort({ observedAt: -1 })
        .lean();
      thermalReading = await computeThermalReading(farm, latestWeather);
    } catch (thermalError) {
      console.warn('Thermal fetch failed:', thermalError.message);
    }

    res.status(200).json({
      success: true,
      ndvi: {
        ndvi: ndviReading.ndvi,
        ndre: ndviReading.ndre,
        hasGrid: !!ndviReading.ndviGrid,
        sceneSource: ndviReading.sceneSource,
        observedAt: ndviReading.observedAt,
      },
      thermal: thermalReading ? {
        lst: thermalReading.estimatedCanopyTempC,
        anomaly: thermalReading.anomalyC,
        hasGrid: !!thermalReading.thermalGrid,
        sceneSource: thermalReading.sceneSource,
        observedAt: thermalReading.observedAt,
      } : null,
    });
  } catch (error) {
    if (error.message === 'FARM_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }
    res.status(500).json({ success: false, message: error.message });
  }
}
