import { Router } from 'express';
import Advisory from '../models/Advisory.js';
import DiagnosisCase from '../models/DiagnosisCase.js';
import Field from '../models/Field.js';
import { localizeAdvisory } from '../services/advisoryService.js';

const router = Router();

/**
 * GET /api/advisories/latest
 * Returns all advisories for the authenticated user's fields (sorted by date, newest first)
 */
router.get('/latest', async (req, res) => {
  try {
    const userId = req.userId || req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    // Find all fields for this user
    const fields = await Field.find({ userId }).select('_id').lean();
    const fieldIds = fields.map(f => f._id);

    // Find all diagnosis cases for these fields that have advisories
    const cases = await DiagnosisCase.find({
      farmId: { $in: fieldIds },
      status: { $ne: 'deleted' },
      outcome: { $in: ['confirmed', 'expert_review'] },
    })
      .populate('farmId', 'name cropType cropStage')
      .sort({ createdAt: -1 })
      .lean();

    // Get the latest advisory for each case
    const advisories = [];
    for (const dc of cases) {
      const advisory = await Advisory.findOne({ caseId: dc._id })
        .sort({ version: -1 })
        .lean();
      if (advisory) {
        advisories.push({
          ...advisory,
          case: {
            _id: dc._id,
            fieldName: dc.farmId?.name || 'Unknown Field',
            cropType: dc.farmId?.cropType || 'unknown',
            cropStage: dc.farmId?.cropStage || 'vegetative',
            outcome: dc.outcome,
            finalDiseaseCode: dc.finalDiseaseCode,
            confidence: dc.confidence,
            finalSeverity: dc.finalSeverity,
            createdAt: dc.createdAt,
          },
        });
      }
    }

    res.json({ advisories });
  } catch (err) {
    console.error('Error fetching latest advisories:', err.message);
    res.status(500).json({ error: 'Failed to fetch advisories' });
  }
});

/**
 * GET /api/advisories/case/:caseId
 * Returns advisory for a specific diagnosis case
 */
router.get('/case/:caseId', async (req, res) => {
  try {
    const { caseId } = req.params;
    const lang = req.query.lang || 'en';

    const dc = await DiagnosisCase.findById(caseId)
      .populate('farmId', 'name cropType cropStage')
      .lean();

    if (!dc || dc.status === 'deleted') {
      return res.status(404).json({ error: 'Case not found' });
    }

    const advisory = await Advisory.findOne({ caseId })
      .sort({ version: -1 })
      .lean();

    if (!advisory) {
      return res.status(404).json({ error: 'No advisory found for this case' });
    }

    // Localize the advisory
    const localized = localizeAdvisory(advisory, lang);

    res.json({
      advisory: {
        ...localized,
        case: {
          _id: dc._id,
          fieldName: dc.farmId?.name || 'Unknown Field',
          cropType: dc.farmId?.cropType || 'unknown',
          cropStage: dc.farmId?.cropStage || 'vegetative',
          outcome: dc.outcome,
          finalDiseaseCode: dc.finalDiseaseCode,
          confidence: dc.confidence,
          finalSeverity: dc.finalSeverity,
          createdAt: dc.createdAt,
        },
      },
    });
  } catch (err) {
    console.error('Error fetching advisory:', err.message);
    res.status(500).json({ error: 'Failed to fetch advisory' });
  }
});

export default router;
