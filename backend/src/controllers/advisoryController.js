import { getAdvisoryForCase, localizeAdvisory } from '../services/advisoryService.js';
import Advisory from '../models/Advisory.js';

/**
 * GET /api/advisory/cases/:caseId
 * Returns the latest advisory for a diagnosis case, localized to user's language.
 */
export async function getCaseAdvisory(req, res) {
  try {
    const { caseId } = req.params;
    const lang = req.query.lang || req.user?.preferredLanguage || 'en';

    const advisory = await getAdvisoryForCase(caseId);
    if (!advisory) {
      return res.json({ success: true, data: null, message: 'No advisory found for this case' });
    }

    const localized = localizeAdvisory(advisory, lang);

    return res.json({ success: true, data: localized });
  } catch (err) {
    console.error('Error fetching advisory:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch advisory' });
  }
}

/**
 * POST /api/advisory/cases/:caseId/regenerate
 * Regenerate advisory for a case (expert/officer only). Increments version.
 */
export async function regenerateAdvisory(req, res) {
  try {
    const { caseId } = req.params;
    const { diseaseCode, severity, cropStage } = req.body;

    // Find latest advisory to get disease/severity if not provided
    const latest = await Advisory.findOne({ caseId }).sort({ version: -1 });
    if (!latest && !diseaseCode) {
      return res.status(400).json({ success: false, message: 'No existing advisory and no diseaseCode provided' });
    }

    const finalDiseaseCode = diseaseCode || latest.diseaseCode;
    const finalSeverity = severity || latest.severity;
    const finalCropStage = cropStage || latest.cropStage;

    // Gemini-first regeneration: load case context (crop, confidence,
    // district) so the new TNAU prompt gets the same inputs as the
    // diagnosis-time path. Falls back to normalized rules internally.
    const { generateAdvisoryForCase } = await import('../services/advisoryService.js');
    const { default: DiagnosisCase } = await import('../models/DiagnosisCase.js');
    const dc = await DiagnosisCase.findById(caseId).lean();

    let cropType = '';
    let confidence;
    let district = '';
    try {
      const { default: Field } = await import('../models/Field.js');
      const { default: User } = await import('../models/User.js');
      const farmId = dc?.farmId || null;
      const [farm, user] = await Promise.all([
        farmId ? Field.findById(farmId).select('cropType').lean() : null,
        dc?.userId ? User.findById(dc.userId).select('farmDetails.district').lean() : null,
      ]);
      cropType = farm?.cropType || '';
      district = user?.farmDetails?.district || '';
      if (Number.isFinite(Number(dc?.confidence))) confidence = Number(dc.confidence);
    } catch { /* context is advisory-only; never block regeneration */ }

    const advisory = await generateAdvisoryForCase(
      caseId,
      finalDiseaseCode,
      finalSeverity,
      finalCropStage,
      cropType,
      { confidence, district },
    );

    return res.json({ success: true, data: advisory });
  } catch (err) {
    console.error('Error regenerating advisory:', err);
    return res.status(500).json({ success: false, message: 'Failed to regenerate advisory' });
  }
}

/**
 * GET /api/advisory/rules/:diseaseCode
 * Preview the advisory rule for a given disease (for expert/officer UI).
 */
export async function getDiseaseRulePreview(req, res) {
  try {
    const { diseaseCode } = req.params;
    const { severity = 'medium', cropStage = 'vegetative', lang = 'en' } = req.query;

    const { generateAdvisoryContent, localizeAdvisory } = await import('../services/advisoryService.js');
    const content = generateAdvisoryContent(diseaseCode, severity, cropStage);

    return res.json({
      success: true,
      data: {
        diseaseCode,
        severity,
        cropStage,
        isGeneric: content.isGeneric,
        cultural: content.cultural.map(a => ({ key: a.actionKey, text: a[lang] || a.en })),
        biological: content.biological.map(a => ({ key: a.actionKey, text: a[lang] || a.en })),
        chemical: content.chemical,
      },
    });
  } catch (err) {
    console.error('Error fetching disease rule:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch disease rule' });
  }
}
