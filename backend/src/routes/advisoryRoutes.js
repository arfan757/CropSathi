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

    // 1. Find all fields for this user
    const fields = await Field.find({ userId }).lean();
    const fieldIds = fields.map(f => f._id || f.id);
    if (fieldIds.length === 0) return res.json({ advisories: [] });

    // 2. Find all relevant diagnosis cases (Supabase adapter — no aggregate())
    const allCases = await DiagnosisCase.find({
      farmId: fieldIds[0], // start with first field; expand below
      status: { $ne: 'deleted' },
    }).limit(200).lean();

    // Collect cases across ALL fields (DiagnosisCase.find filters by one farmId,
    // so we query each field's cases and merge)
    const casesByField = await Promise.all(
      fieldIds.map(fid => DiagnosisCase.find({ farmId: fid, status: { $ne: 'deleted' } }).limit(50).lean())
    );
    const cases = casesByField
      .flat()
      .filter(dc => dc.outcome === 'confirmed' || dc.outcome === 'expert_review')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 100);

    if (cases.length === 0) return res.json({ advisories: [] });

    // 3. Build a farm lookup map
    const farmMap = {};
    for (const f of fields) farmMap[f._id || f.id] = f;

    // 4. Fetch latest advisory for each case (parallel)
    const advisoryResults = await Promise.all(
      cases.map(dc => Advisory.findOne({ caseId: dc._id || dc.id }).sort({ version: -1 }).lean())
    );

    // 5. Assemble response — skip cases that have no advisory yet
    const advisories = [];
    for (let i = 0; i < cases.length; i++) {
      const dc = cases[i];
      const advisory = advisoryResults[i];
      if (!advisory) continue;
      const farm = farmMap[dc.farmId] || null;
      advisories.push({
        ...advisory,
        sprayWindow: advisory.sprayWindow || advisory.chemicalRecommendation?.sprayWindow || null,
        weatherContext: advisory.weatherContext || advisory.chemicalRecommendation?.weatherContext || null,
        case: {
          _id: dc._id || dc.id,
          fieldName: farm?.name || 'Unknown Field',
          cropType: farm?.cropType || 'unknown',
          cropStage: farm?.cropStage || 'vegetative',
          outcome: dc.outcome,
          finalDiseaseCode: dc.finalDiseaseCode,
          confidence: dc.confidence,
          finalSeverity: dc.finalSeverity,
          createdAt: dc.createdAt,
        },
      });
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

    // Supabase adapter does not support .populate() — load farm separately
    const dc = await DiagnosisCase.findById(caseId);
    if (!dc || dc.status === 'deleted') {
      return res.status(404).json({ error: 'Case not found' });
    }

    const farm = dc.farmId ? await Field.findById(dc.farmId) : null;

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
          _id: dc._id || dc.id,
          fieldName: farm?.name || 'Unknown Field',
          cropType: farm?.cropType || 'unknown',
          cropStage: farm?.cropStage || 'vegetative',
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
  // New path: group remedies[] by type (cultural → physical → biological →
  // chemical). Rich item fields ride along for the updated card renderer;
  // `text` preserves the legacy shape for old clients.
  if (Array.isArray(advisory.remedies) && advisory.remedies.length > 0) {
    const labels = { cultural: 'Cultural & Mechanical', physical: 'Physical', biological: 'Biological', chemical: 'Chemical' };
    const cleanNA = (v) => (!v || /^(n\/?a|none|nil|-|not applicable)$/i.test(String(v).trim())) ? '' : String(v).trim();
    const plan = [];
    for (const tier of ['cultural', 'physical', 'biological', 'chemical']) {
      const group = advisory.remedies.filter((r) => r.type === tier);
      if (group.length === 0) continue;
      plan.push({
        tier,
        label: labels[tier],
        items: group.map((r, i) => {
          const phi = r.preHarvestIntervalDays ?? null;
          const cleanProd = cleanNA(r.productName);
          const cleanDos = cleanNA(r.dosage);
          const base = {
            actionKey: `${tier}_${i + 1}`,
            text: r.action || '',
            action: r.action || '',
            productName: cleanProd,
            dosage: cleanDos,
            frequency: cleanNA(r.frequency),
            timing: cleanNA(r.timing),
            preHarvestIntervalDays: phi,
            safetyNotes: r.safetyNotes || '',
          };
          if (tier === 'chemical') {
            return {
              ...base,
              productClass: cleanProd || r.action || 'Chemical Treatment',
              unit: '',
              safetyNotes: r.safetyNotes
                || (phi ? `Do not harvest for ${phi} days after application` : ''),
            };
          }
          return base;
        }),
      });
    }
    return plan;
  }
  // Legacy path: tier fields only (old docs) — unchanged.
  const plan = [];
  if (advisory.ipmCulturalActions?.length) {
    plan.push({
      tier: 'cultural',
      label: 'Cultural & Mechanical',
      items: advisory.ipmCulturalActions.map(a => ({
        actionKey: a.actionKey,
        text: a.en || a.text || '',
      })),
    });
  }
  if (advisory.ipmBiologicalActions?.length) {
    plan.push({
      tier: 'biological',
      label: 'Biological',
      items: advisory.ipmBiologicalActions.map(a => ({
        actionKey: a.actionKey,
        text: a.en || a.text || '',
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

    // 1. Diagnosis case + farm (Supabase adapter: no .populate(), load farm separately)
    const dc = await DiagnosisCase.findById(caseId);
    if (!dc || dc.status === 'deleted') {
      return res.status(404).json({ error: 'Case not found' });
    }
    const farm = (dc.farmId ? await Field.findById(dc.farmId) : null) || {};

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

    // 9. Summary from advisory (Gemini) with diagnosis fallback; new
    // About-disease fields pass through null-safe for legacy advisories.
    const summary = advisory.summary || dc.geminiResult?.diseaseDescription || '';

    // Weather & Safe Spray Window resolution
    let sprayWindow = advisory.sprayWindow || advisory.chemicalRecommendation?.sprayWindow || null;
    let weatherContext = advisory.weatherContext || advisory.chemicalRecommendation?.weatherContext || null;
    if (!sprayWindow && farm._id) {
      try {
        const { getRecentWeather } = await import('../services/weatherService.js');
        const { calculateSprayWindow } = await import('../services/advisoryService.js');
        const recents = await getRecentWeather(farm._id, 1);
        if (recents && recents.length > 0) {
          sprayWindow = calculateSprayWindow(recents[0]);
          weatherContext = sprayWindow.metrics;
        }
      } catch (swErr) {
        console.warn('Dynamic spray window computation failed:', swErr.message);
      }
    }

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
        pathogenName: advisory.pathogenName || '',
        symptoms: advisory.symptoms || '',
        followUpDays: advisory.followUpDays ?? null,
        source: advisory.source || 'rules',
        isGeneric: Boolean(advisory.isGeneric),
        remedyPlan: buildRemedyPlan(localized),
        sprayWindow,
        weatherContext,
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
