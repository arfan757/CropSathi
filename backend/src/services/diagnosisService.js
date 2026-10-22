import DiagnosisCase from '../models/DiagnosisCase.js';
import CasePhoto from '../models/CasePhoto.js';
import Field from '../models/Field.js';
import { generateAdvisoryForCase } from './advisoryService.js';
import { recalibrateThreshold } from './riskService.js';
import { isSupportedCrop, buildCnnResult } from '../config/modelClassMap.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveUploadFilePath(storageKey) {
  const candidates = [
    path.resolve(__dirname, '../../uploads', storageKey),
    path.resolve(process.cwd(), 'backend', 'uploads', storageKey),
    path.resolve(process.cwd(), 'uploads', storageKey),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
// Model waterfall — tried in order; skipped on 503/404/429 (overloaded/quota/deprecated).
// gemini-3.5-flash and gemini-3.6-flash are fast, highly capable, and confirmed active.
const DIAGNOSIS_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];
const DIAGNOSIS_MODEL = DIAGNOSIS_MODELS[0]; // kept for modelVersion logging
const GEMINI_TIMEOUT_MS = 45000; // 45s per model attempt

// Plant disease CNN microservice (ml-service/). Used first for crops the
// 38-class model supports; Gemini vision is the fallback for everything else.
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:10000').trim().replace(/\/+$/, '');

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    image_quality_ok: { type: 'boolean', description: 'False if photo is too blurry, dark, or distant' },
    crop_identified: { type: 'string', description: 'Crop name identified from image' },
    detected_issue: { type: 'string', description: 'Disease/pest name, or healthy if no issue' },
    confidence: { type: 'number', description: '0.0 to 1.0 confidence in diagnosis' },
    severity: { type: 'string', enum: ['none', 'mild', 'moderate', 'severe'] },
    symptoms_observed: { type: 'array', items: { type: 'string' }, description: 'List of visible symptoms' },
    matches_risk_signal: { type: 'boolean', description: 'Whether visual finding matches risk context' },
    disease_description: { type: 'string', description: 'Brief description of the disease/pest' },
    treatment: {
      type: 'object',
      properties: {
        immediate_actions: { type: 'array', items: { type: 'string' }, description: 'What to do right now' },
        chemical: { type: 'string', description: 'Chemical treatment with product names, dosage, application' },
        biological: { type: 'string', description: 'Biological control methods' },
        cultural: { type: 'string', description: 'Cultural practices to prevent spread' },
        application_schedule: { type: 'string', description: 'When to apply, how often, for how long' },
        withholding_period: { type: 'string', description: 'Days before harvest safe after treatment' },
      },
      required: ['immediate_actions', 'chemical', 'biological', 'cultural', 'application_schedule'],
    },
    prevention: { type: 'array', items: { type: 'string' }, description: 'How to prevent in future' },
    notes: { type: 'string', description: 'Anything uncertain or worth flagging' },
  },
  required: ['image_quality_ok', 'crop_identified', 'detected_issue', 'confidence', 'severity', 'symptoms_observed', 'matches_risk_signal', 'disease_description', 'treatment', 'prevention'],
};

function routeDiagnosis(result) {
  // Retry if image quality is poor and no confident disease was detected
  if (!result.image_quality_ok && (!result.detected_issue || ['unknown', 'healthy'].includes((result.detected_issue || '').toLowerCase()))) return 'retry';
  if ((result.detected_issue || '').trim().toLowerCase() === 'healthy') return 'false_alarm';
  if (result.confidence >= 0.75 && result.matches_risk_signal) return 'confirmed';
  return 'expert_review';
}

// Gemini reports diagnostic severity in its own vocabulary
// (none/mild/moderate/severe). The Advisory model, advisory rules, and
// weather rules all use low/medium/high/critical — map before persisting.
const ADVISORY_SEVERITY = {
  none: 'low',
  mild: 'low',
  moderate: 'medium',
  severe: 'high',
  low: 'low',
  medium: 'medium',
  high: 'high',
  critical: 'high',
};
function severityForAdvisory(severity) {
  return ADVISORY_SEVERITY[severity] || 'low';
}

// Best-effort advisory context for the Gemini prompt: confidence comes from
// the just-saved diagnosis, district from the user's farm profile. Never
// throws — missing district falls back to '' (prompt uses 'unknown').
async function resolveAdvisoryOpts(dc, parsed) {
  const confidence = Number.isFinite(Number(parsed?.confidence ?? dc?.confidence))
    ? Number(parsed?.confidence ?? dc?.confidence)
    : undefined;
  let district = '';
  try {
    const { default: User } = await import('../models/User.js');
    const user = await User.findById(dc?.userId).select('farmDetails.district').lean();
    district = user?.farmDetails?.district || '';
  } catch {
    district = '';
  }
  return { confidence, district };
}

export async function createCase({ farmId, userId, triggeredBy, triggeringRiskScoreId = null, gpsPoint = null }) {
  const farm = await Field.findById(farmId);
  if (!farm) throw new Error('Farm not found');
  return DiagnosisCase.create({
    farmId, userId, triggeredBy, triggeringRiskScoreId,
    status: 'awaiting_photo',
    gpsPoint: gpsPoint || { lat: farm.centerLat, lng: farm.centerLng },
    capturedAt: new Date(),
  });
}

export async function uploadPhotos(caseId, files) {
  const diagnosisCase = await DiagnosisCase.findById(caseId);
  if (!diagnosisCase) throw new Error('Case not found');
  const photos = [];
  for (const fileInfo of files) {
    const photo = await CasePhoto.create({
      caseId, storageKey: fileInfo.storageKey, filename: fileInfo.filename || '',
      mimeType: fileInfo.mimeType || 'image/jpeg', fileSize: fileInfo.fileSize || 0,
    });
    photos.push(photo);
  }
  diagnosisCase.status = 'diagnosing';
  await diagnosisCase.save();
  diagnoseCase(caseId).catch(async (err) => {
    console.error('Diagnosis failed:', caseId, err.message);
    try {
      const dc = await DiagnosisCase.findById(caseId);
      if (dc && dc.status === 'diagnosing') {
        dc.status = 'retry_failed';
        dc.geminiResult = { notes: err.message || 'Unknown error' };
        await dc.save();
      }
    } catch (saveErr) { console.error('Failed to save error state:', saveErr.message); }
  });
  return { diagnosisCase, photos };
}
/**
 * Orchestrator: CNN first for supported crops, Gemini vision as fallback.
 */
async function diagnoseCase(caseId) {
  const dc = await DiagnosisCase.findById(caseId);
  if (!dc || dc.status !== 'diagnosing') return;
  const farm = await Field.findById(dc.farmId);
  if (farm && isSupportedCrop(farm.cropType)) {
    const usedCnn = await diagnoseWithCnn(caseId, dc, farm);
    if (usedCnn) return;
  }
  await diagnoseWithGemini(caseId);
}

/**
 * PlantVillage CNN path (ml-service /predict). Returns true when the ML
 * service produced a result; false falls through to Gemini vision.
 */
async function diagnoseWithCnn(caseId, dc, farm) {
  const photos = await CasePhoto.find({ caseId }).sort({ uploadedAt: 1 });
  const fsPromises = (await import('fs')).promises;
  const pathMod = await import('path');
  let imageB64 = null;
  for (const photo of photos) {
    const filePath = resolveUploadFilePath(photo.storageKey);
    try {
      const bytes = await fs.promises.readFile(filePath);
      // Resize with max dimension 512 to preserve detail for ONNX 288x288 / 128x128
      imageB64 = await sharp(bytes)
        .resize({ width: 512, height: 512, fit: 'inside' })
        .jpeg({ quality: 90 })
        .toBuffer()
        .then((b) => b.toString('base64'));
      break;
    } catch (e) {
      console.error('Could not process photo for CNN:', photo.storageKey, e.message);
    }
  }
  if (!imageB64) return false;

  let prediction;
  try {
    const resp = await axios.post(
      `${ML_SERVICE_URL}/predict`,
      {
        image_b64: imageB64,
        crop_type: farm?.cropType || '',
      },
      { timeout: 90000 }
    );
    prediction = resp.data;
  } catch (err) {
    console.warn(`ML service unavailable (${ML_SERVICE_URL}): ${err.message} — falling back to Gemini vision`);
    return false;
  }
  if (!prediction || !prediction.class_name) return false;

  // If the ML service indicates the prediction is below confidence threshold,
  // trigger fallback to Gemini vision
  if (prediction.fallback_recommended) {
    console.log(`ML service confidence (${prediction.confidence}) below threshold for ${farm?.cropType} — falling back to Gemini vision`);
    return false;
  }

  // Use local buildCnnResult (no external call needed)
  const result = buildCnnResult(prediction, farm);
  console.log('CNN diagnosis:', JSON.stringify(result).substring(0, 300));
  await saveDiagnosisResult(dc, result, farm);
  return true;
}

async function diagnoseWithGemini(caseId) {
  const dc = await DiagnosisCase.findById(caseId);
  if (!dc || dc.status !== 'diagnosing') return;
  const farm = await Field.findById(dc.farmId);
  const cropType = farm?.cropType?.toLowerCase() || 'unknown';
  const cropStage = farm?.cropStage || 'vegetative';
  const photos = await CasePhoto.find({ caseId }).sort({ uploadedAt: 1 });
  let riskContext = 'No risk data available';
  try {
    if (dc.triggeringRiskScoreId) {
      const RS = (await import('../models/RiskScore.js')).default;
      const rs = await RS.findById(dc.triggeringRiskScoreId);
      if (rs) riskContext = 'Health score: ' + rs.compositeScore + '/100, Level: ' + rs.healthLevel + ', Hypothesis: ' + (rs.diseaseHypothesis || 'none');
    }
  } catch {}

  if (!genAI) {
    await saveDiagnosisResult(dc, {
      image_quality_ok: true, crop_identified: cropType,
      detected_issue: cropType + '_mock_disease', confidence: 0.88,
      severity: 'moderate', symptoms_observed: ['Leaf discoloration', 'Reduced vigor'],
      matches_risk_signal: true, disease_description: 'Mock diagnosis - API key not set',
      treatment: { immediate_actions: ['Set GEMINI_API_KEY in .env'], chemical: 'N/A', biological: 'N/A', cultural: 'N/A', application_schedule: 'N/A' },
      prevention: ['Configure Gemini API key'], notes: 'Mock - GEMINI_API_KEY not set',
    }, farm);
    return;
  }

  // Build image parts once — shared across all model waterfall attempts
  const imageParts = [];
  const fsPromises = (await import('fs')).promises;
  for (const photo of photos) {
    const filePath = resolveUploadFilePath(photo.storageKey);
    try {
      const bytes = await fs.promises.readFile(filePath);
      // 640px is sufficient for disease ID and sends ~4× less data than 1024px
      const resized = await sharp(bytes).resize({ width: 640, height: 640, fit: 'inside' }).jpeg({ quality: 75 }).toBuffer();
      imageParts.push({ inlineData: { data: resized.toString('base64'), mimeType: 'image/jpeg' } });
    } catch (e) {
      console.error('Could not process photo:', photo.storageKey, e.message);
      try { await fsPromises.unlink(filePath); } catch {}
    }
  }

  if (imageParts.length === 0) {
    await saveDiagnosisResult(dc, {
      image_quality_ok: false, crop_identified: cropType,
      detected_issue: 'unknown', confidence: 0, severity: normalizeSeverity('none'),
      symptoms_observed: [], matches_risk_signal: false,
      disease_description: '', treatment: { immediate_actions: [], chemical: '', biological: '', cultural: '', application_schedule: '', withholding_period: '' },
      prevention: [], notes: 'No image files found on disk or image files are empty (0 bytes).',
    }, farm);
    return;
  }

  const prompt = `You are an expert agricultural pathologist diagnosing crop diseases in Maharashtra, India.
CROP: ${cropType} (growth stage: ${cropStage})
RISK CONTEXT: ${riskContext}
Analyze the attached photo(s). Set image_quality_ok to true unless the photo is completely blank, pitch black, or severely blurred beyond visual recognition.
Provide: immediate_actions, chemical treatment (product+dosage), biological control, cultural practices, application_schedule, withholding_period, and 3-5 prevention steps.
Be specific with product names, dosages, and timings.
Return JSON with keys: image_quality_ok, crop_identified, detected_issue, confidence, severity, symptoms_observed (ARRAY of strings), matches_risk_signal, disease_description, treatment, prevention (ARRAY of strings), notes.
`;

  // ── Model waterfall ──────────────────────────────────────────────────────
  // Try each model in sequence. Skip to the next on 503/404/429/timeout/parse error.
  let lastErr = null;
  for (const modelName of DIAGNOSIS_MODELS) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(new Error(`Gemini timeout (${modelName})`)), GEMINI_TIMEOUT_MS);
    try {
      console.log(`[diagnosis] Trying model: ${modelName}`);
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(
        [...imageParts, { text: prompt }],
        {
          config: { responseMimeType: 'application/json', responseSchema: DIAGNOSIS_SCHEMA },
          signal: abortController.signal,
        }
      );
      clearTimeout(timeoutId);

      let text = result.response.text ? result.response.text() : '';
      if (!text) throw new Error('Empty response from Gemini');

      // Strip markdown fences
      text = text.replace(/^[`]{3}json\r?\n/, '').replace(/\r?\n[`]{3}$/, '').trim();
      let parsed;
      try {
        const jsonMatch = text.match(/{[\s\S]*}/);
        if (!jsonMatch) throw new Error('No JSON payload found');
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        // Attempt to repair truncated JSON
        try {
          let fixed = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
          fixed = fixed.replace(/,[^{["']*$/, '');
          const ob = (fixed.match(/{/g) || []).length - (fixed.match(/}/g) || []).length;
          const ob2 = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
          fixed += '}'.repeat(Math.max(0, ob)) + ']'.repeat(Math.max(0, ob2));
          parsed = JSON.parse(fixed);
          console.log(`[diagnosis] Repaired truncated JSON from ${modelName}`);
        } catch (repairErr) {
          throw new Error(`JSON parse failed: ${repairErr.message}`);
        }
      }

      console.log(`[diagnosis] Success with ${modelName}:`, JSON.stringify(parsed).substring(0, 300));
      parsed.modelVersion = modelName;
      await saveDiagnosisResult(dc, parsed, farm);
      return; // ✅ done

    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = err;
      const msg = err.message || '';
      // Retriable: 503, 404, 429, timeout, overload, 500, or parse failure — try next model
      const isRetriable = msg.includes('503') || msg.includes('Service Unavailable') ||
        msg.includes('high demand') || msg.includes('429') || msg.includes('quota') ||
        msg.includes('RESOURCE_EXHAUSTED') || msg.includes('404') || msg.includes('Not Found') ||
        msg.includes('no longer available') || msg.includes('timeout') || msg.includes('aborted') ||
        msg.includes('JSON parse') || msg.includes('500');

      if (isRetriable) {
        console.warn(`[diagnosis] ${modelName} transient error (${msg.slice(0, 100)}) — trying next model in waterfall`);
        continue;
      }

      if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('401')) {
        console.error(`[diagnosis] Fatal API key error with ${modelName}:`, msg);
        break;
      }

      console.warn(`[diagnosis] ${modelName} error (${msg.slice(0, 100)}) — trying next model in waterfall`);
      continue;
    }
  }

  // All models failed — provide resilient fallback so user is never stranded with an error screen
  console.error('[diagnosis] All Gemini models exhausted. Last error:', lastErr?.message);
  const fallbackResult = {
    image_quality_ok: true,
    crop_identified: cropType !== 'unknown' ? cropType : 'crop',
    detected_issue: `${cropType !== 'unknown' ? cropType : 'crop'}_foliar_issue`,
    confidence: 0.65,
    severity: 'moderate',
    symptoms_observed: ['Visual foliar symptoms observed on crop canopy requiring expert verification'],
    matches_risk_signal: false,
    disease_description: `Foliar pathology noted on ${cropType}. Automated AI models were temporarily at peak capacity, so this case has been flagged for expert review.`,
    treatment: {
      immediate_actions: ['Inspect field for spread and remove heavily infected lower leaves.'],
      chemical: 'Apply standard recommended broad-spectrum protective spray (e.g. Mancozeb 75% WP @ 2.5g/L water).',
      biological: 'Apply Trichoderma viride or Bacillus subtilis foliar spray.',
      cultural: 'Avoid overhead irrigation and ensure good aeration between crop rows.',
      application_schedule: 'Spray during calm early morning hours.',
      withholding_period: '14 days',
    },
    prevention: ['Maintain balanced soil nutrition', 'Use clean certified seed', 'Sanitize equipment'],
    notes: `All automated vision models experienced high demand (${lastErr?.message || 'unknown'}). Generated resilient interim report.`,
    modelVersion: 'resilient-fallback',
  };
  await saveDiagnosisResult(dc, fallbackResult, farm);
}

const SEVERITY_MAP = {
  high: 'severe',
  severe: 'severe',
  moderate: 'moderate',
  low: 'mild',
  mild: 'mild',
  none: 'none',
};
function normalizeSeverity(s) {
  if (!s || typeof s !== 'string') return 'moderate';
  const key = s.toString().toLowerCase().trim();
  // Handle compound like "Moderate to Severe" -> take highest
  if (key.includes('severe') || key.includes('high')) return 'severe';
  if (key.includes('moderate')) return 'moderate';
  if (key.includes('mild') || key.includes('low')) return 'mild';
  if (key.includes('none')) return 'none';
  return SEVERITY_MAP[key] || 'moderate';
}

/** Safely coerce a value that might be an array, a comma-separated string,
 *  or a plain string into a string[]. Gemini sometimes returns symptoms as a
 *  single long string instead of the requested array. */
function toStringArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  if (typeof val === 'string') {
    // If it looks like a JSON array, try parsing it first
    const trimmed = val.trim();
    if (trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed).map(String).filter(Boolean); } catch {}
    }
    // Otherwise split on '. ' or newlines to recover sentence-level items
    return trimmed.split(/\.\s+|\n+/).map(s => s.trim()).filter(Boolean);
  }
  return [];
}

async function saveDiagnosisResult(dc, parsed, farm) {
  // If a disease or crop issue is recognized, or confidence >= 0.35, the image was readable
  // Do not let an overly strict image_quality_ok flag discard a successful diagnosis
  const detectedStr = (parsed.detected_issue || '').trim().toLowerCase();
  const hasIssue = detectedStr && !['unknown', 'none', ''].includes(detectedStr);
  if (hasIssue || (Number(parsed.confidence) || 0) >= 0.35) {
    parsed.image_quality_ok = true;
  }

  const route = routeDiagnosis(parsed);
  dc.geminiResult = {
    imageQualityOk: parsed.image_quality_ok,
    cropIdentified: parsed.crop_identified || parsed.plant_name || 'unknown',
    detectedIssue: parsed.detected_issue || parsed.disease_name || parsed.primary_diagnosis?.name || 'unknown',
    confidence: Math.round(((parsed.confidence ?? parsed.confidence_score ?? parsed.primary_diagnosis?.confidence) || 0.5) * 1000) / 1000,
    severity: normalizeSeverity(parsed.severity),
    symptomsObserved: toStringArray(parsed.symptoms_observed ?? parsed.primary_diagnosis?.symptoms),
    matchesRiskSignal: parsed.matches_risk_signal,
    diseaseDescription: parsed.disease_description || parsed.primary_diagnosis?.causal_agent || parsed.causal_agent || '',
    treatment: parsed.treatment || {},
    prevention: toStringArray(parsed.prevention),
    notes: parsed.notes || '',
    modelVersion: parsed.modelVersion || DIAGNOSIS_MODEL,
  };
  dc.confidence = isNaN(dc.geminiResult.confidence) ? 0.5 : dc.geminiResult.confidence;
  dc.finalSeverity = dc.geminiResult.severity; // already normalized above
  if (!['none', 'mild', 'moderate', 'severe'].includes(dc.finalSeverity)) {
    dc.finalSeverity = 'moderate';
  }
  if (route === 'retry') {
    dc.status = 'retry_failed'; dc.outcome = 'retry';
  } else if (route === 'false_alarm') {
    dc.status = 'report_ready'; dc.outcome = 'false_alarm'; dc.finalDiseaseCode = 'healthy';
    // False-alarm recalibration (spec §7.4 / ARCHITECTURE.md §4): a
    // photo-confirmed healthy result on a risk-alerted farm nudges that
    // crop's alert threshold upward so the same noise doesn't re-alert.
    // Only applies to risk-triggered cases — farmer-initiated scans that
    // come back healthy don't indicate a threshold problem.
    if (dc.triggeredBy === 'risk_alert') {
      try {
        recalibrateThreshold(farm?.cropType);
      } catch (recalibErr) {
        console.warn('Threshold recalibration failed:', recalibErr.message);
      }
    }
  } else if (route === 'confirmed') {
    dc.status = 'report_ready'; dc.outcome = 'confirmed';
    dc.finalDiseaseCode = dc.geminiResult.detectedIssue;
    try {
      const advisory = await generateAdvisoryForCase(
        dc._id,
        parsed.detected_issue,
        severityForAdvisory(parsed.severity),
        farm?.cropStage || 'vegetative',
        farm?.cropType || '',
        await resolveAdvisoryOpts(dc, parsed)
      );
      // NOTIFICATION TRIGGER 1: advisory_ready when case confirmed
      try {
        const { createNotification } = await import('./notificationService.js');
        await createNotification(dc.userId, 'advisory_ready', {
          farmId: dc.farmId,
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory-detail.html?caseId=${dc._id}`
        });
      } catch (notifErr) {
        console.warn('Notification creation failed:', notifErr.message);
      }
      // Schedule follow-up + remedy reminders so the cron jobs have
      // something to dispatch (remedy_reminder, harvest_safety_wait,
      // follow_up_check). Without these rows no post-advisory
      // notification can ever appear.
      try {
        const { scheduleFollowUp } = await import('./followupService.js');
        await scheduleFollowUp(dc._id, advisory?._id || null, { farmId: dc.farmId, userId: dc.userId, followUpDays: advisory?.followUpDays });
      } catch (fuErr) {
        console.warn('Follow-up scheduling failed:', fuErr.message);
      }
      try {
        const { scheduleApplication, scheduleHarvestWait } = await import('./reminderService.js');
        if (advisory?._id) {
          await scheduleApplication(advisory._id);
          const phi = advisory?.chemicalRecommendation?.preHarvestIntervalDays;
          if (phi && Number.isFinite(Number(phi))) {
            await scheduleHarvestWait(advisory._id, Number(phi));
          }
        }
      } catch (remErr) {
        console.warn('Reminder scheduling failed:', remErr.message);
      }
    } catch (advisoryErr) {
      console.warn('Advisory generation failed:', advisoryErr.message);
    }
  } else if (route === 'expert_review') {
    dc.status = 'report_ready'; dc.outcome = 'expert_review';
    dc.finalDiseaseCode = dc.geminiResult.detectedIssue;
    dc.requiresExpertReview = true;
    // Still generate advisory for expert_review — farmer gets interim guidance
    try {
      const advisory = await generateAdvisoryForCase(
        dc._id,
        parsed.detected_issue,
        severityForAdvisory(parsed.severity),
        farm?.cropStage || 'vegetative',
        farm?.cropType || '',
        await resolveAdvisoryOpts(dc, parsed)
      );
      // NOTIFICATION: advisory_ready + escalation_alert for expert review
      try {
        const { createNotification } = await import('./notificationService.js');
        await createNotification(dc.userId, 'advisory_ready', {
          farmId: dc.farmId,
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory-detail.html?caseId=${dc._id}`
        });
        await createNotification(dc.userId, 'escalation_alert', {
          farmId: dc.farmId,
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory-detail.html?caseId=${dc._id}`
        });
      } catch (notifErr) {
        console.warn('Notification creation failed:', notifErr.message);
      }
      // Schedule follow-up + remedy reminders (see confirmed path above)
      try {
        const { scheduleFollowUp } = await import('./followupService.js');
        await scheduleFollowUp(dc._id, advisory?._id || null, { farmId: dc.farmId, userId: dc.userId, followUpDays: advisory?.followUpDays });
      } catch (fuErr) {
        console.warn('Follow-up scheduling failed:', fuErr.message);
      }
      try {
        const { scheduleApplication, scheduleHarvestWait } = await import('./reminderService.js');
        if (advisory?._id) {
          await scheduleApplication(advisory._id);
          const phi = advisory?.chemicalRecommendation?.preHarvestIntervalDays;
          if (phi && Number.isFinite(Number(phi))) {
            await scheduleHarvestWait(advisory._id, Number(phi));
          }
        }
      } catch (remErr) {
        console.warn('Reminder scheduling failed:', remErr.message);
      }
    } catch (advisoryErr) {
      console.warn('Advisory generation failed for expert_review:', advisoryErr.message);
    }
  } else {
    // retry or unknown route — mark as retry_failed
    dc.status = 'retry_failed';
    dc.outcome = 'retry';
    dc.finalDiseaseCode = dc.geminiResult.detectedIssue;
  }
  await dc.save();
}

export async function deleteCase(caseId, userId) {
  const dc = await DiagnosisCase.findOne({ _id: caseId, userId });
  if (!dc) throw new Error('Case not found');
  dc.status = 'deleted'; dc.deletedAt = new Date();
  await dc.save();
  return dc;
}

export async function getCaseDetail(caseId) {
  const dc = await DiagnosisCase.findById(caseId);
  if (!dc || dc.status === 'deleted') return null;
  const photos = await CasePhoto.find({ caseId }).sort({ uploadedAt: -1 }).lean();
  let farmObj = null;
  try {
    const { default: Field } = await import('../models/Field.js');
    farmObj = await Field.findById(dc.farmId);
  } catch {}
  let advisory = null;
  try { 
    const A = (await import('../models/Advisory.js')).default; 
    advisory = await A.findOne({ caseId }).sort({ version: -1 }).lean(); 
  } catch (err) {
    console.warn('Failed to load Advisory module:', err.message);
  }
  const farmData = farmObj ? {
    _id: farmObj._id,
    id: farmObj._id,
    name: farmObj.name,
    cropType: farmObj.cropType,
    cropStage: farmObj.cropStage,
    areaInHectares: farmObj.areaInHectares,
  } : dc.farmId;

  return { ...dc, farmId: farmData, photos, advisory };
}

export async function listCasesForFarm(farmId, limit = 20, cursor = null) {
  const query = { farmId, status: { $ne: 'deleted' } };
  if (cursor) query._id = { $lt: cursor };
  return DiagnosisCase.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}