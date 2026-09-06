import DiagnosisCase from '../models/DiagnosisCase.js';
import CasePhoto from '../models/CasePhoto.js';
import Field from '../models/Field.js';
import { generateAdvisoryForCase } from './advisoryService.js';
import { recalibrateThreshold } from './riskService.js';
import { isSupportedCrop, buildCnnResult } from '../config/modelClassMap.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { classifyDisease, structureCnnResult } from './minimaxService.js';
import axios from 'axios';
import sharp from 'sharp';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const DIAGNOSIS_MODEL = 'gemini-3.6-flash';
const GEMINI_TIMEOUT_MS = 90000;

// Plant disease CNN microservice (ml-service/). Used first for crops the
// 38-class model supports; Gemini vision is the fallback for everything else.
const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '');

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
  // Only retry if image quality is poor AND no disease was detected (uncertain)
  if (!result.image_quality_ok && (result.detected_issue || '').toLowerCase() === 'unknown') return 'retry';
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
    const filePath = pathMod.join(process.cwd(), 'uploads', photo.storageKey);
    try {
      const bytes = await fsPromises.readFile(filePath);
      imageB64 = await sharp(bytes)
        .resize({ width: 128, height: 128, fit: 'inside' })
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
      { image_b64: imageB64 },
      { timeout: 30000 }
    );
    prediction = resp.data;
  } catch (err) {
    console.warn(`ML service unavailable (${ML_SERVICE_URL}): ${err.message} — falling back to Gemini vision`);
    return false;
  }
  if (!prediction || !prediction.class_name) return false;

  // 1. Try to structure CNN result with Minimax (better formatted output)
  try {
    const topKNames = (prediction.top_k || []).map(t => t.class_name);
    const minimaxResult = await structureCnnResult(
      prediction.class_name,
      prediction.confidence,
      topKNames,
      farm.cropType || ''
    );
    if (minimaxResult && minimaxResult.detected_issue) {
      // Merge Minimax's structured output with CNN confidence
      minimaxResult.confidence = Math.round((prediction.confidence || 0.5) * 1000) / 1000;
      minimaxResult.matches_risk_signal = minimaxResult.confidence >= 0.75;
      minimaxResult.modelVersion = minimaxResult.modelVersion || 'plant-disease-cnn-38';
      minimaxResult._modelSource = 'cnn+minimax';
      console.log('CNN+Minimax diagnosis:', JSON.stringify(minimaxResult).substring(0, 300));
      await saveGeminiResult(dc, minimaxResult, farm);
      return true;
    }
  } catch (minimaxErr) {
    console.warn('[diagnosisService] Minimax CNN structuring failed, using direct mapping:', minimaxErr.message);
  }

  // 2. Fallback: use local buildCnnResult (no external call)
  const result = buildCnnResult(prediction, farm);
  console.log('CNN diagnosis (direct):', JSON.stringify(result).substring(0, 300));
  await saveGeminiResult(dc, result, farm);
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
    await saveGeminiResult(dc, {
      image_quality_ok: true, crop_identified: cropType,
      detected_issue: cropType + '_mock_disease', confidence: 0.88,
      severity: 'moderate', symptoms_observed: ['Leaf discoloration', 'Reduced vigor'],
      matches_risk_signal: true, disease_description: 'Mock diagnosis - API key not set',
      treatment: { immediate_actions: ['Set GEMINI_API_KEY in .env'], chemical: 'N/A', biological: 'N/A', cultural: 'N/A', application_schedule: 'N/A' },
      prevention: ['Configure Gemini API key'], notes: 'Mock - GEMINI_API_KEY not set',
    }, farm);
    return;
  }

  const model = genAI.getGenerativeModel({ model: DIAGNOSIS_MODEL });
  const imageParts = [];
  const fsPromises = (await import('fs')).promises;
  const pathMod = await import('path');
  for (const photo of photos) {
    const filePath = pathMod.join(process.cwd(), 'uploads', photo.storageKey);
    try {
      const bytes = await fsPromises.readFile(filePath);
      const resized = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
      imageParts.push({ inlineData: { data: resized.toString("base64"), mimeType: "image/jpeg" } });
    } catch (e) { 
      console.error('Could not process photo, cleaning up file:', photo.storageKey, e.message); 
      try { await fsPromises.unlink(filePath); } catch (unlinkErr) {}
    }
  }

  if (imageParts.length === 0) {
    await saveGeminiResult(dc, {
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
Analyze the attached photo(s). If blurry/dark, set image_quality_ok to false.
Provide: immediate_actions, chemical treatment (product+dosage), biological control, cultural practices, application_schedule, withholding_period, and 3-5 prevention steps.
Be specific with product names, dosages, and timings.
Output ONLY raw JSON with these exact root-level keys: image_quality_ok, crop_identified, detected_issue, confidence, severity, symptoms_observed, matches_risk_signal, disease_description, treatment, prevention, notes.
`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(new Error('Gemini timeout after 90s')), GEMINI_TIMEOUT_MS);

  try {
    const result = await model.generateContent(
        [...imageParts, { text: prompt }],
        { 
        config: { responseMimeType: 'application/json', responseSchema: DIAGNOSIS_SCHEMA },
        signal: abortController.signal
      }
      );
    clearTimeout(timeoutId);
    
    let text = result.response.text ? result.response.text() : '';
    if (!text) throw new Error('Empty response from Gemini');
    let parsed;
    try {
      // Strip markdown fences before parsing
      text = text.replace(new RegExp('^[>```json\r?\n'), '').replace(new RegExp('\r?\n```$'), '').trim();
      const jsonMatch = text.match(/{[\s\S]*}/);
      if (!jsonMatch) throw new Error('No JSON payload found in response');
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      // Handle truncated JSON from Gemini - try to fix and re-parse
      try {
        let fixed = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        // Remove trailing incomplete value
        fixed = fixed.replace(/,[^{[\"']*$/, '');
        // Close open braces
        const openB = (fixed.match(/{/g) || []).length;
        const closeB = (fixed.match(/}/g) || []).length;
        for (let i = 0; i < openB - closeB; i++) fixed += '}';
        // Close open brackets
        const openS = (fixed.match(/\[/g) || []).length;
        const closeS = (fixed.match(/\]/g) || []).length;
        for (let i = 0; i < openS - closeS; i++) fixed += ']';
        console.log('Fixed truncated JSON, retrying parse...');
        parsed = JSON.parse(fixed);
      } catch (retryErr) {
        console.error('JSON parse failed even after fix. Raw text:', text.substring(0, 500));
        throw parseErr;
      }
    }
    console.log('Gemini parsed result:', JSON.stringify(parsed).substring(0, 500));
    await saveGeminiResult(dc, parsed, farm);
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Gemini error:', err.message);

    // FALLBACK: Try Minimax via OpenRouter for image-based diagnosis
    try {
      console.log('[diagnosisService] Falling back to Minimax M3 for disease classification');
      const imageBase64 = imageParts.length > 0
        ? imageParts[0].inlineData.data
        : null;
      if (imageBase64) {
        const minimaxResult = await classifyDisease(
          imageBase64,
          cropType,
          cropStage,
          riskContext
        );
        if (minimaxResult && minimaxResult.detected_issue) {
          // If response seems truncated/incomplete, retry with structural prompt
          if (!minimaxResult.treatment || !Array.isArray(minimaxResult.treatment.immediate_actions) || minimaxResult.treatment.immediate_actions.length === 0) {
            console.warn('[diagnosisService] Minimax result incomplete; retrying for structured output');
            const retryResult = await classifyDisease(
              imageBase64,
              cropType,
              cropStage,
              'IMPORTANT: Respond ONLY with the complete JSON object. Do not truncate. Include all keys: image_quality_ok, crop_identified, detected_issue, confidence, severity, symptoms_observed, matches_risk_signal, disease_description, treatment (with immediate_actions, chemical, biological, cultural, application_schedule, withholding_period), prevention, notes.'
            );
            if (retryResult && retryResult.treatment && retryResult.treatment.immediate_actions) {
              await saveGeminiResult(dc, retryResult, farm);
              console.log('Minimax fallback diagnosis (retry) saved:', JSON.stringify(retryResult).substring(0, 200));
              return;
            }
            await saveGeminiResult(dc, minimaxResult, farm);
            console.log('Minimax fallback diagnosis saved:', JSON.stringify(minimaxResult).substring(0, 200));
            return;
          }
          await saveGeminiResult(dc, minimaxResult, farm);
          console.log('Minimax fallback diagnosis saved:', JSON.stringify(minimaxResult).substring(0, 200));
          return;
        }
      }
    } catch (minimaxErr) {
      console.warn('Minimax fallback also failed:', minimaxErr.message);
    }

    // Both models failed — save failure state
    await DiagnosisCase.updateOne(
      { _id: caseId },
      { $set: { status: 'retry_failed', geminiResult: { notes: err.message + ' | Minimax fallback also failed' } } }
    );
  }
}

const SEVERITY_MAP = {
  high: 'severe', severe: 'severe', 'high': 'severe', 'severe': 'severe',
  moderate: 'moderate', 'moderate': 'moderate',
  low: 'mild', mild: 'mild', 'low': 'mild', 'mild': 'mild',
  none: 'none', 'none': 'none',
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

async function saveGeminiResult(dc, parsed, farm) {
  const route = routeDiagnosis(parsed);
  dc.geminiResult = {
    imageQualityOk: parsed.image_quality_ok,
    cropIdentified: parsed.crop_identified || parsed.plant_name || 'unknown',
    detectedIssue: parsed.detected_issue || parsed.disease_name || parsed.primary_diagnosis?.name || 'unknown',
    confidence: Math.round(((parsed.confidence ?? parsed.confidence_score ?? parsed.primary_diagnosis?.confidence) || 0.5) * 1000) / 1000,
    severity: normalizeSeverity(parsed.severity),
    symptomsObserved: parsed.symptoms_observed || parsed.primary_diagnosis?.symptoms || [],
    matchesRiskSignal: parsed.matches_risk_signal,
    diseaseDescription: parsed.disease_description || parsed.primary_diagnosis?.causal_agent || parsed.causal_agent || '',
    treatment: parsed.treatment || {},
    prevention: parsed.prevention || [],
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
        farm?.cropType || ''
      );
      // NOTIFICATION TRIGGER 1: advisory_ready when case confirmed
      try {
        const { createNotification } = await import('./notificationService.js');
        await createNotification(dc.userId, 'advisory_ready', {
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory?caseId=${dc._id}`
        });
      } catch (notifErr) {
        console.warn('Notification creation failed:', notifErr.message);
      }
      // NOTIFICATION TRIGGER: schedule follow-up reminder
      try {
        const { scheduleFollowUp } = await import('./followupService.js');
        await scheduleFollowUp(dc._id, advisory?._id || null);
      } catch (fuErr) {
        console.warn('Follow-up scheduling failed:', fuErr.message);
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
        farm?.cropType || ''
      );
      // NOTIFICATION: advisory_ready (with expert review caveat)
      try {
        const { createNotification } = await import('./notificationService.js');
        await createNotification(dc.userId, 'advisory_ready', {
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory?caseId=${dc._id}`
        });
      } catch (notifErr) {
        console.warn('Notification creation failed:', notifErr.message);
      }
      // Also send escalation_alert for expert review
      try {
        const { createNotification } = await import('./notificationService.js');
        await createNotification(dc.userId, 'escalation_alert', {
          caseId: dc._id,
          advisoryId: advisory?._id || null,
          deepLink: `/advisory?caseId=${dc._id}`
        });
      } catch (notifErr) {
        console.warn('Escalation notification failed:', notifErr.message);
      }
      // Schedule follow-up
      try {
        const { scheduleFollowUp } = await import('./followupService.js');
        await scheduleFollowUp(dc._id, advisory?._id || null);
      } catch (fuErr) {
        console.warn('Follow-up scheduling failed:', fuErr.message);
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
  const dc = await DiagnosisCase.findById(caseId)
    .populate('farmId', 'name cropType cropStage areaInHectares').lean();
  if (!dc || dc.status === 'deleted') return null;
  const photos = await CasePhoto.find({ caseId }).sort({ uploadedAt: -1 }).lean();
  let advisory = null;
  try { 
    const A = (await import('../models/Advisory.js')).default; 
    advisory = await A.findOne({ caseId }).sort({ version: -1 }).lean(); 
  } catch (err) {
    console.warn('Failed to load Advisory module:', err.message);
  }
  return { ...dc, photos, advisory };
}

export async function listCasesForFarm(farmId, limit = 20, cursor = null) {
  const query = { farmId, status: { $ne: 'deleted' } };
  if (cursor) query._id = { $lt: cursor };
  return DiagnosisCase.find(query).sort({ createdAt: -1 }).limit(limit).lean();
}