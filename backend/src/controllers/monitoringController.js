import Field from '../models/Field.js';
import {
  getRiskHistory,
  getLatestRiskScore,
  computeRiskScore,
} from '../services/riskService.js';
import {
  getRecentWeather,
  pollWeatherForFarm,
} from '../services/weatherService.js';
import {
  getRecentNdvi,
  fetchNdviForFarm,
} from '../services/ndviService.js';
import {
  getRecentThermal,
  computeThermalReading,
} from '../services/thermalService.js';

// ─── Risk Endpoints ────────────────────────────────────────────────────────

export async function getRiskHistoryEndpoint(req, res) {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 20;
    const cursor = req.query.cursor || null;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const history = await getRiskHistory(farmId, limit, cursor);

    res.status(200).json({
      success: true,
      count: history.length,
      data: history,
      nextCursor: history.length === limit ? history[history.length - 1]?.computedAt : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getRiskLatestEndpoint(req, res) {
  try {
    const { farmId } = req.params;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const latest = await getLatestRiskScore(farmId);

    res.status(200).json({
      success: true,
      data: latest || {
        compositeScore: 50,
        healthLevel: 'watch',
        triggeredAlert: false,
        weatherComponent: 0.5,
        ndviComponent: 0.5,
        thermalComponent: 0.5,
        pestHistoryComponent: 0,
        diseaseHypothesis: null,
        computedAt: null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Weather Endpoints ──────────────────────────────────────────────────────

export async function getWeatherEndpoint(req, res) {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const readings = await getRecentWeather(farmId, limit);

    res.status(200).json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function pollWeatherEndpoint(req, res) {
  try {
    const { farmId } = req.params;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    // Fetch fresh weather + recompute full risk score (all 4 components)
    const weatherReading = await pollWeatherForFarm(farm);
    const riskScore = await computeRiskScore(farmId);

    res.status(200).json({
      success: true,
      weather: weatherReading,
      riskScore,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── NDVI Endpoints ─────────────────────────────────────────────────────────

export async function getNdviEndpoint(req, res) {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const readings = await getRecentNdvi(farmId, limit);

    res.status(200).json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function pollNdviEndpoint(req, res) {
  try {
    const { farmId } = req.params;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const reading = await fetchNdviForFarm(farm);

    res.status(200).json({
      success: true,
      data: reading,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Thermal Endpoints ──────────────────────────────────────────────────────

export async function getThermalEndpoint(req, res) {
  try {
    const { farmId } = req.params;
    const limit = parseInt(req.query.limit) || 10;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    const readings = await getRecentThermal(farmId, limit);

    res.status(200).json({
      success: true,
      count: readings.length,
      data: readings,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function pollThermalEndpoint(req, res) {
  try {
    const { farmId } = req.params;

    const farm = await Field.findOne({ _id: farmId, userId: req.user.id });
    if (!farm) {
      return res.status(404).json({ success: false, message: 'Farm not found' });
    }

    // Get latest weather reading to compute thermal from
    const weatherReadings = await getRecentWeather(farmId, 1);
    if (!weatherReadings.length) {
      return res.status(400).json({ success: false, message: 'No weather data available. Poll weather first.' });
    }

    const reading = await computeThermalReading(farm, weatherReadings[0]);

    res.status(200).json({
      success: true,
      data: reading,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// ─── Satellite Sync (Force Refresh) ──────────────────────────────────────

/**
 * POST /api/monitoring/sync-satellite
 * Force-refresh satellite data (NDVI + thermal) and recompute risk scores
 * for all of the authenticated user's fields. This is the endpoint the
 * "Sentinel Sync" button in the dashboard calls.
 *
 * Unlike poll-weather (single-farm), this processes ALL farms in one call
 * and returns per-farm results so the frontend can show progress.
 */
export async function syncSatelliteEndpoint(req, res) {
  try {
    const userId = req.user.id;
    const farms = await Field.find({ userId, status: 'active', deletedAt: null }).lean();

    if (farms.length === 0) {
      return res.status(200).json({
        success: true,
        data: { synced: 0, failed: 0, results: [] },
      });
    }

    const results = [];

    for (const farm of farms) {
      const startMs = Date.now();
      try {
        // 1. Fetch fresh weather
        const weatherReading = await pollWeatherForFarm(farm);

        // 2. Fetch fresh NDVI (re-fetches from Sentinel-2, bypasses any stale cache)
        const ndviReading = await fetchNdviForFarm(farm);

        // 3. Compute fresh thermal reading
        let thermalReading = null;
        try {
          thermalReading = await computeThermalReading(farm, weatherReading);
        } catch (_) { /* thermal optional */ }

        // 4. Full risk score recomputation (uses the fresh readings above)
        const riskScore = await computeRiskScore(farm._id);

        results.push({
          farmId: farm._id,
          farmName: farm.name,
          success: true,
          compositeScore: riskScore.compositeScore,
          sceneSource: ndviReading?.sceneSource || 'unknown',
          ndvi: ndviReading?.ndvi ?? null,
          durationMs: Date.now() - startMs,
        });
      } catch (err) {
        console.error(`Sync failed for farm ${farm._id} (${farm.name}):`, err.message);
        results.push({
          farmId: farm._id,
          farmName: farm.name,
          success: false,
          error: err.message,
          durationMs: Date.now() - startMs,
        });
      }
    }

    const synced = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.status(200).json({
      success: true,
      data: { synced, failed, results },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
