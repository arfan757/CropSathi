import Field from '../models/Field.js';
import { computeRiskScore } from '../services/riskService.js';

// @desc    Create a new field
// @route   POST /api/fields
// @access  Private
export const createField = async (req, res) => {
  try {
    const { name, cropType, sowingDate, polygon, boundary, areaInHectares, areaInAcres, cropStage, soilType } = req.body;

    // Accept polygon (legacy) or boundary (GeoJSON)
    if (!polygon || polygon.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Polygon must have at least 3 points',
      });
    }

    const field = await Field.create({
      userId: req.user.id,
      name,
      cropType,
      cropStage,
      sowingDate,
      polygon,
      boundary,
      areaInHectares,
      areaInAcres,
      soilType,
    });

    res.status(201).json({
      success: true,
      data: field,
    });

    // Trigger initial risk score computation in background (fire-and-forget)
    computeRiskScore(field._id).catch(err => {
      console.error(`⚠️ Initial risk score failed for field ${field._id}:`, err.message);
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// @desc    Get all fields for current user
// @route   GET /api/fields
// @access  Private
export const getFields = async (req, res) => {
  try {
    const fields = await Field.find({ userId: req.user.id }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: fields.length,
      data: fields,
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
    const field = await Field.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });

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
    // Whitelist allowed fields to prevent mass assignment
    const allowedFields = ['name', 'cropType', 'cropStage', 'sowingDate', 'polygon', 'boundary', 'areaInHectares', 'areaInAcres', 'soilType', 'status'];
    const updates = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    // Auto-generate GeoJSON boundary from polygon if updating polygon
    if (updates.polygon && updates.polygon.length >= 3 && (!updates.boundary || !updates.boundary.coordinates?.length)) {
      const ring = updates.polygon.map(p => [p.lng, p.lat]);
      ring.push(ring[0]); // close the ring
      updates.boundary = { type: 'Polygon', coordinates: [ring] };
    }

    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, deletedAt: null },
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

    // Re-compute risk score if crop-related fields changed
    if (updates.cropType || updates.cropStage) {
      computeRiskScore(field._id).catch(err => {
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
    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, deletedAt: null },
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
    // Bypass soft-delete filter to find the deleted field
    const field = await Field.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, deletedAt: { $ne: null } },
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
