import Field from '../models/Field.js';
import NdviReading from '../models/NdviReading.js';
import supabase from '../config/supabase.js';
import { computeRiskScore } from '../services/riskService.js';
import { fetchNdviForFarm, isVegetationDetected } from '../services/ndviService.js';
import { computeThermalReading } from '../services/thermalService.js';
import { inferCropStage, daysSinceSowing, isValidCropStage } from '../services/cropStageService.js';

// @desc    Infer growth stage from crop type + sowing date (single source of truth)
// @route   GET /api/fields/infer-stage?cropType=Cotton&sowingDate=2026-06-01
// @access  Private
export const inferStage = async (req, res) => {
  try {
    const { cropType, sowingDate } = req.query;
    const stage = inferCropStage(cropType, sowingDate);
    if (!stage) {
      return res.status(400).json({
        success: false,
        message: 'cropType and a valid sowingDate are required',
      });
    }
    return res.status(200).json({
      success: true,
      data: { stage, daysSinceSowing: daysSinceSowing(sowingDate) },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Create a new field
// @route   POST /api/fields
// @access  Private
export const createField = async (req, res) => {
  try {
    const {
      name,
      cropType,
      variety,
      sowingDate,
      polygon,
      boundary,
      areaInHectares,
      areaInAcres,
      soilType,
    } = req.body;
    // Explicit farmer choice wins; otherwise infer from sowing date so the
    // field does not silently score as 'vegetative' forever. Empty string
    // (form "Auto" option) counts as "not provided".
    let { cropStage } = req.body;
    let stageSource = cropStage ? 'user' : 'inferred';
    if (!cropStage && cropType && sowingDate) {
      cropStage = inferCropStage(cropType, sowingDate) || undefined;
    }
    if (cropStage !== undefined && !isValidCropStage(cropStage)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid cropStage. Must be one of: sowing, vegetative, flowering, fruiting, maturity, harvested.',
      });
    }

    // 1. Boundary array check
    if (!polygon || polygon.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Polygon must have at least 3 points',
      });
    }

    // 2. Instantiate and save field
    const userId = req.user?.id || req.user?._id;
    const field = new Field({
      userId,
      name,
      cropType,
      variety: variety || null,
      cropStage,
      stageSource,
      sowingDate,
      polygon,
      boundary,
      areaInHectares,
      areaInAcres,
      soilType,
    });
    await field.save();

    // 3. Optical Spectral Baseline Verification
    // Wrapped in try/catch: satellite API failures must NOT prevent a valid
    // field save. If the NDVI fetch throws (network error, Supabase timeout,
    // Copernicus auth issue), we fail open and let the cron job retry later.
    let ndviReading = null;
    try {
      ndviReading = await fetchNdviForFarm(field);
    } catch (ndviError) {
      console.warn(`⚠️ NDVI fetch failed during field creation for ${field._id}:`, ndviError.message);
    }

    const isValidVegetation = isVegetationDetected(
      ndviReading?.ndvi,
      ndviReading?.ndre,
      ndviReading?.sceneSource
    );

    console.log(`Field creation NDVI check: source=${ndviReading?.sceneSource}, ndvi=${ndviReading?.ndvi}, ndre=${ndviReading?.ndre}, valid=${isValidVegetation}`);

    if (!isValidVegetation) {
      // Remove the temporary NDVI reading and field so no orphan records remain
      await NdviReading.deleteMany({ farmId: field._id });
      await field.deleteOne();

      return res.status(400).json({
        success: false,
        message: 'Invalid boundary: Non-agricultural land detected (NDVI < 0.20). Please select an active crop field.',
      });
    }

    res.status(201).json({
      success: true,
      data: field,
    });

    // 5. Background data pre-fetch: risk score + thermal reading
    // NDVI/NDRE were already fetched above (validation step).
    // Thermal is fetched here so analytics page has all 3 layers on first visit.
    computeRiskScore(field._id).catch((err) => {
      console.error(`⚠️ Initial risk score failed for field ${field._id}:`, err.message);
    });

    computeThermalReading(field).catch((err) => {
      console.error(`⚠️ Initial thermal fetch failed for field ${field._id}:`, err.message);
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Helper to build standardized healthScore object
export function formatFieldHealthScore(score) {
  if (!score) {
    return {
      hasData: false,
      data: null,
      compositeScore: null,
      healthLevel: null,
      confidence: 'low',
      confidenceReasons: ['no_satellite_data'],
      sceneSource: 'none',
      isSimulated: false,
      sceneAgeDays: null,
      cloudCoverPct: null,
      noVegetationDetected: false,
      triggeredAlert: false,
      weatherRiskHypothesis: null,
      diseaseHypothesis: null,
      staleSignals: [],
      computedAt: null,
      components: { ndviStress: null, ndreStress: null, thermalStress: null },
    };
  }

  const noVeg = Boolean(score.no_vegetation_detected ?? score.noVegetationDetected ?? false);
  const compScore = score.composite_score !== null && score.composite_score !== undefined
    ? Number(score.composite_score)
    : (score.compositeScore !== undefined ? Number(score.compositeScore) : null);
  const isSim = Boolean(score.is_simulated ?? score.isSimulated ?? false);
  const conf = score.confidence || 'low';

  const snapshot = score.inputs_snapshot || score.inputsSnapshot || {};
  const sceneSource = score.scene_source || score.sceneSource || snapshot.sceneSource || snapshot.dataSources?.ndvi || 'unknown';
  const sceneAgeDays = score.scene_age_days !== null && score.scene_age_days !== undefined
    ? Number(score.scene_age_days)
    : (score.sceneAgeDays !== undefined ? score.sceneAgeDays : (snapshot.sceneAgeDays ?? null));
  const cloudCoverPct = score.cloud_cover_pct !== null && score.cloud_cover_pct !== undefined
    ? Number(score.cloud_cover_pct)
    : (score.cloudCoverPct !== undefined ? score.cloudCoverPct : (snapshot.cloudCoverPct ?? null));

  return {
    hasData: compScore !== null || noVeg,
    compositeScore: compScore,
    healthLevel: score.health_level || score.healthLevel || null,
    confidence: conf,
    confidenceReasons: score.confidence_reasons || score.confidenceReasons || [],
    sceneSource,
    isSimulated: isSim || Boolean(snapshot.isSimulated),
    sceneAgeDays,
    cloudCoverPct,
    noVegetationDetected: noVeg,
    triggeredAlert: Boolean(score.triggered_alert ?? score.triggeredAlert ?? false),
    weatherRiskHypothesis: score.weather_risk_hypothesis || score.disease_hypothesis || null,
    diseaseHypothesis: score.weather_risk_hypothesis || score.disease_hypothesis || null,
    staleSignals: score.stale_signals || score.staleSignals || [],
    computedAt: score.computed_at || score.computedAt || null,
    components: {
      ndviStress: score.ndvi_stress ?? score.ndviStress ?? score.ndvi_component ?? null,
      ndreStress: score.ndre_stress ?? score.ndreStress ?? score.ndre_component ?? null,
      thermalStress: score.thermal_stress ?? score.thermalStress ?? score.thermal_component ?? null,
    },
  };
}

// @desc    Get all fields for current user (enriched with health scores in batch: F-02, F-16)
// @route   GET /api/fields
// @access  Private
export const getFields = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const fields = await Field.find({ userId, deletedAt: null }).sort({ createdAt: -1 });

    const fieldIds = fields.map(f => String(f._id));
    const latestScoreByFarmId = {};

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validUuids = fieldIds.filter(id => uuidRegex.test(id));

    if (validUuids.length > 0) {
      try {
        const { data: scores, error } = await supabase
          .from('risk_scores')
          .select('*')
          .in('farm_id', validUuids)
          .order('computed_at', { ascending: false });

        if (error) {
          console.warn('Supabase risk_scores query warning:', error.message);
        } else {
          for (const s of scores || []) {
            const farmId = String(s.farm_id || s.farmId);
            if (!latestScoreByFarmId[farmId]) {
              latestScoreByFarmId[farmId] = s;
            }
          }
        }
      } catch (scoreErr) {
        console.warn('Failed to batch-fetch risk scores for fields:', scoreErr.message);
      }
    }

    const enrichedFields = fields.map(f => {
      const fieldObj = f.toObject ? f.toObject() : { ...f };
      const fieldIdStr = String(f._id);
      const score = latestScoreByFarmId[fieldIdStr] || latestScoreByFarmId[f._id] || null;
      fieldObj.healthScore = formatFieldHealthScore(score);
      return fieldObj;
    });

    res.status(200).json({
      success: true,
      count: enrichedFields.length,
      data: enrichedFields,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get single field
// @route   GET /api/fields/:id
// @access  Private
export const getField = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const field = await Field.findOne({
      _id: req.params.id,
      userId,
      deletedAt: null,
    });

    if (!field) {
      return res.status(404).json({
        success: false,
        message: 'Field not found',
      });
    }

    let latestScore = null;
    const fieldIdStr = String(field._id);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fieldIdStr)) {
      try {
        const { data, error } = await supabase
          .from('risk_scores')
          .select('*')
          .eq('farm_id', fieldIdStr)
          .order('computed_at', { ascending: false })
          .limit(1)
          .single();
        if (!error) latestScore = data;
      } catch {
        // Best-effort
      }
    }

    const fieldObj = field.toObject ? field.toObject() : { ...field };
    fieldObj.healthScore = formatFieldHealthScore(latestScore);

    res.status(200).json({
      success: true,
      data: fieldObj,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Update field
// @route   PUT /api/fields/:id
// @access  Private
export const updateField = async (req, res) => {
  try {
    const allowedFields = [
      'name',
      'cropType',
      'variety',
      'cropStage',
      'stageSource',
      'sowingDate',
      'polygon',
      'boundary',
      'areaInHectares',
      'areaInAcres',
      'soilType',
      'status',
    ];

    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Empty-string stage (form "Auto") means "re-infer", not "store ''".
    if (updates.cropStage === '') delete updates.cropStage;

    if (updates.cropStage !== undefined) {
      if (!isValidCropStage(updates.cropStage)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid cropStage. Must be one of: sowing, vegetative, flowering, fruiting, maturity, harvested.',
        });
      }
      updates.stageSource = 'user';
    }

    // Sowing date or crop changed without an explicit stage: re-infer so the
    // stored stage stays consistent instead of going stale.
    if (updates.cropStage === undefined && (updates.sowingDate || updates.cropType)) {
      const userId = req.user?.id || req.user?._id;
      const current = await Field.findOne(
        { _id: req.params.id, userId, deletedAt: null },
        { cropType: 1, sowingDate: 1 }
      ).lean();
      if (current) {
        const effectiveCrop = updates.cropType ?? current.cropType;
        const effectiveSowing = updates.sowingDate ?? current.sowingDate;
        const inferred = inferCropStage(effectiveCrop, effectiveSowing);
        if (inferred) {
          updates.cropStage = inferred;
          updates.stageSource = 'inferred';
        }
      }
    }

    if (updates.polygon && updates.polygon.length >= 3 && (!updates.boundary || !updates.boundary.coordinates?.length)) {
      const ring = updates.polygon.map((p) => [p.lng, p.lat]);
      ring.push(ring[0]);
      updates.boundary = { type: 'Polygon', coordinates: [ring] };
    }

    const userId = req.user?.id || req.user?._id;
    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId, deletedAt: null },
      updates,
      { new: true, runValidators: true }
    );

    if (!field) {
      return res.status(404).json({
        success: false,
        message: 'Field not found',
      });
    }

    res.status(200).json({
      success: true,
      data: field,
    });

    if (updates.cropType || updates.cropStage || updates.sowingDate) {
      computeRiskScore(field._id).catch((err) => {
        console.error(`⚠️ Risk score re-computation failed for field ${field._id}:`, err.message);
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Soft delete field
// @route   DELETE /api/fields/:id
// @access  Private
export const deleteField = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );

    if (!field) {
      return res.status(404).json({
        success: false,
        message: 'Field not found',
      });
    }

    res.status(200).json({
      success: true,
      message: 'Field deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Restore soft-deleted field
// @route   PATCH /api/fields/:id/restore
// @access  Private
export const restoreField = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId, deletedAt: { $ne: null } },
      { deletedAt: null },
      { new: true }
    );

    if (!field) {
      return res.status(404).json({
        success: false,
        message: 'Deleted field not found',
      });
    }

    res.status(200).json({
      success: true,
      data: field,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};