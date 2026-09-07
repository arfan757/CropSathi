import { Router } from 'express';
import Advisory from '../models/Advisory.js';
import DiagnosisCase from '../models/DiagnosisCase.js';
import Field from '../models/Field.js';
import Reminder from '../models/Reminder.js';
import FollowUp from '../models/FollowUp.js';
import RiskScore from '../models/RiskScore.js';
import Notification from '../models/Notification.js';
import { localizeAdvisory } from '../services/advisoryService.js';
import { completeReminder } from '../services/reminderService.js';
import { protect } from '../middleware/authMiddleware.js';

const router = Router();

// All advisory routes require authentication
router.use(protect);

/**
 * GET /api/advisories/latest
 * Returns all advisories for the authenticated user's fields (sorted by date, newest first)
 */
router.get('/latest', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    // Find all fields for this user
    const fields = await Field.find({ userId }).select('_id').lean();
    const fieldIds = fields.map(f => f._id);
    if (fieldIds.length === 0) return res.json({ advisories: [] });

    // Join cases with their farm and latest advisory in one aggregation
    // instead of one Advisory query per case (N+1).
    const cases = await DiagnosisCase.aggregate([
      {
        $match: {
          farmId: { $in: fieldIds },
          status: { $ne: 'deleted' },
          outcome: { $in: ['confirmed', 'expert_review'] },
        },
      },
      { $sort: { createdAt: -1 } },
      { $lookup: { from: 'fields', localField: 'farmId', foreignField: '_id', as: 'farm' } },
      { $lookup: { from: 'advisories', localField: '_id', foreignField: 'caseId', as: 'advs' } },
      {
        $addFields: {
          // latest advisory version wins
          advisory: { $arrayElemAt: [{ $sortArray: { input: '$advs', sortBy: { version: -1 } } }, 0] },
        },
      },
      { $match: { advisory: { $ne: null } } },
      { $limit: 100 },
    ]);

    const advisories = cases.map((dc) => {
      const farm = dc.farm && dc.farm.length > 0 ? dc.farm[0] : null;
      return {
        ...dc.advisory,
        case: {
          _id: dc._id,
          fieldName: farm?.name || 'Unknown Field',
          cropType: farm?.cropType || 'unknown',
          cropStage: farm?.cropStage || 'vegetative',
          outcome: dc.outcome,
          finalDiseaseCode: dc.finalDiseaseCode,
          confidence: dc.confidence,
          finalSeverity: dc.finalSeverity,
          createdAt: dc.createdAt,
        },
      };
    });

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

// ─────────────────────────────────────────────────────────────────────────────
// Advisory Detail — the single endpoint powering /advisory.html?caseId=<id>
// ─────────────────────────────────────────────────────────────────────────────

function deriveAdvisoryStatus(outcome, followUps) {
  if (outcome === 'expert_review') return 'escalated';
  const worst = followUps.find(f => f.status === 'completed_unimproved' || f.status === 'escalated');
  if (worst) return 'escalated';
  const improved = followUps.filter(f => f.status === 'completed_improved');
  if (improved.length >= 2) return 'closed';
  if (improved.length >= 1) return 'recovering';
  return 'active';
}

function buildRemedyPlan(advisory) {
  const plan = [];
  if (advisory.ipmCulturalActions?.length) {
    plan.push({
      tier: 'cultural',
      label: 'Cultural & Mechanical',
      items: advisory.ipmCulturalActions.map(a => ({
        actionKey: a.actionKey,
        text: a.en || '',
      })),
    });
  }
  if (advisory.ipmBiologicalActions?.length) {
    plan.push({
      tier: 'biological',
      label: 'Biological',
      items: advisory.ipmBiologicalActions.map(a => ({
        actionKey: a.actionKey,
        text: a.en || '',
      })),
    });
  }
  if (advisory.chemicalRecommendation) {
    const c = advisory.chemicalRecommendation;
    plan.push({
      tier: 'chemical',
      label: 'Chemical',
      items: [{
        actionKey: 'chemical_1',
        productClass: c.productClass || '',
        dosage: c.dosage || '',
        unit: c.unit || '',
        frequency: c.frequency || '',
        timing: c.applicationTiming || '',
        preHarvestIntervalDays: c.preHarvestIntervalDays || null,
        safetyNotes: c.preHarvestIntervalDays
          ? `Do not harvest for ${c.preHarvestIntervalDays} days after application`
          : null,
      }],
    });
  }
  return plan;
}

/**
 * GET /api/advisory/case/:caseId/detail
 * Full detail payload for the advisory page.
 * Returns: { advisory, reminders, follow_ups, health_score_trend }
 */
router.get('/case/:caseId/detail', async (req, res) => {
  try {
    const { caseId } = req.params;
    const lang = req.query.lang || 'en';

    // 1. Diagnosis case + farm
    const dc = await DiagnosisCase.findById(caseId)
      .populate('farmId', 'name cropType cropStage centerLat centerLng')
      .lean();
    if (!dc || dc.status === 'deleted') {
      return res.status(404).json({ error: 'Case not found' });
    }
    const farm = dc.farmId || {};

    // 2. Latest advisory
    const advisory = await Advisory.findOne({ caseId })
      .sort({ version: -1 })
      .lean();
    if (!advisory) {
      return res.status(404).json({ error: 'No advisory found for this case' });
    }
    const localized = localizeAdvisory(advisory, lang);

    // 3. Reminders linked to this advisory
    const reminders = await Reminder.find({ advisoryId: advisory._id })
      .sort({ dueAt: 1 })
      .lean();

    // 4. Follow-ups linked to this case
    const followUps = await FollowUp.find({ caseId })
      .sort({ scheduledFor: -1 })
      .lean();

    // 5. Health score trend (last 10 from RiskScore for this farm)
    let healthScoreTrend = [];
    if (farm._id) {
      const scores = await RiskScore.find({ farmId: farm._id })
        .sort({ computedAt: -1 })
        .limit(10)
        .select({ computedAt: 1, compositeScore: 1 })
        .lean();
      healthScoreTrend = scores.reverse().map(s => ({
        date: s.computedAt,
        score: s.compositeScore,
      }));
    }

    // 6. Derive status
    const status = deriveAdvisoryStatus(dc.outcome, followUps);

    // 7. Escalation info
    const escalateToCropsap = status === 'escalated';
    const escalationReason = escalateToCropsap
      ? (dc.requiresExpertReview
        ? 'Case routed for expert review'
        : 'Crop condition reported as worsening — extension officer will follow up')
      : null;

    // 8. Severity mapping (backend low/medium/high → display mild/moderate/severe)
    const sevMap = { low: 'mild', medium: 'moderate', high: 'severe', critical: 'severe' };
    const displaySeverity = sevMap[advisory.severity] || 'moderate';

    // 9. Summary from diagnosis
    const summary = dc.geminiResult?.diseaseDescription || '';

    // 10. Assemble response
    res.json({
      advisory: {
        id: advisory._id,
        caseId: dc._id,
        crop: farm.cropType || 'unknown',
        cropStage: farm.cropStage || 'vegetative',
        fieldName: farm.name || 'Unknown Field',
        diseaseOrPest: advisory.diseaseCode || dc.finalDiseaseCode || 'unknown',
        confidence: dc.confidence || 0,
        severity: displaySeverity,
        severityRaw: advisory.severity,
        summary,
        remedyPlan: buildRemedyPlan(localized),
        escalateToCropsap,
        escalationReason,
        createdAt: advisory.generatedAt || advisory.createdAt,
        status,
        caseOutcome: dc.outcome,
      },
      reminders: reminders.map(r => ({
        id: r._id,
        reminderType: r.reminderType,
        dueAt: r.dueAt,
        status: r.status,
      })),
      follow_ups: followUps.map(f => ({
        id: f._id,
        scheduledAt: f.scheduledFor,
        status: f.status,
        farmerResponse: f.farmerResponse || null,
        completedAt: f.completedAt || null,
      })),
      health_score_trend: healthScoreTrend,
    });
  } catch (err) {
    console.error('Error fetching advisory detail:', err.message);
    res.status(500).json({ error: 'Failed to fetch advisory detail' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Reminder complete — "Mark as applied" from the advisory page
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/advisory/reminders/:id/complete
 * Marks a reminder done and updates any linked notification.
 */
router.post('/reminders/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const reminder = await Reminder.findById(id);
    if (!reminder) return res.status(404).json({ error: 'Reminder not found' });

    // Mark reminder done
    await completeReminder(id);

    // Mark any linked notification as action-taken
    const notifTypeMap = {
      application: 'remedy_reminder',
      reapplication: 'reapplication_reminder',
      harvest_wait: 'harvest_safety_wait',
    };
    if (reminder.reminderType && notifTypeMap[reminder.reminderType]) {
      await Notification.findOneAndUpdate(
        {
          userId,
          type: notifTypeMap[reminder.reminderType],
          advisoryId: reminder.advisoryId,
          actionTaken: { $ne: 'done' },
        },
        { $set: { actionTaken: 'done', read: true, readAt: new Date() } }
      );
    }

    // If multi-dose reapplication, schedule next reminder
    if (reminder.reminderType === 'reapplication') {
      const nextDue = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await Reminder.create({
        advisoryId: reminder.advisoryId,
        reminderType: 'reapplication',
        dueAt: nextDue,
        status: 'pending',
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Error completing reminder:', err.message);
    res.status(500).json({ error: 'Failed to complete reminder' });
  }
});

export default router;
