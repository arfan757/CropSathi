import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Advisory from '../models/Advisory.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
// Model waterfall — text-only (advisory), cheaper than vision.
// Tried in order; skipped on 503/404/429 (overloaded/not found/rate-limited).
const ADVISORY_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];
const ADVISORY_MODEL = ADVISORY_MODELS[0]; // kept for legacy reference
const ADVISORY_TIMEOUT_MS = 45000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let advisoryRules = null;

function loadRules() {
  if (advisoryRules) return advisoryRules;
  try {
    const rulesPath = join(__dirname, '../config/advisoryRules.json');
    const raw = readFileSync(rulesPath, 'utf-8');
    advisoryRules = JSON.parse(raw);
    const count = Object.keys(advisoryRules.rules).length;
    console.log(`📋 Loaded advisory rules v${advisoryRules.version} (${count} diseases)`);
    return advisoryRules;
  } catch (err) {
    console.error('⚠️  Failed to load advisory rules:', err.message);
    advisoryRules = { rules: {} };
    return advisoryRules;
  }
}

loadRules();

/**
 * Normalize a free-text diagnosis into an advisoryRules.json key.
 * Gemini returns labels like "Red Rot of Sugarcane" while the rules table
 * uses snake_case keys ("sugarcane_red_rot") — without normalization every
 * such case missed the rules table and fell through to the generic
 * "Continue regular field monitoring" branch.
 *
 * Tries: exact key → `${crop}_${disease}` → unambiguous suffix match.
 * Returns null when nothing matches (caller uses the generic branch).
 */
export function normalizeDiseaseCode(diseaseCode, cropType = '', knownKeys = []) {
  if (!diseaseCode) return null;
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const code = slug(diseaseCode);
  if (!code || code === 'unknown' || code === 'healthy') return null;
  const keys = knownKeys.length > 0 ? knownKeys : Object.keys(loadRules().rules || {});
  if (keys.includes(code)) return code;
  const crop = slug(cropType);
  const FILLER = new Set(['of', 'in', 'on', 'the', 'disease', 'infection', 'syndrome']);
  // Core disease tokens: drop the crop token and filler words so
  // "red_rot_of_sugarcane" → "red_rot".
  const coreOf = (s) => String(s || '')
    .split('_')
    .filter((p) => p && p !== crop && !FILLER.has(p))
    .join('_');
  const bases = [code];
  if (crop && code.startsWith(`${crop}_`)) bases.unshift(code.slice(crop.length + 1));
  const core = coreOf(code);
  if (core && core !== code) bases.push(core);
  for (const base of bases) {
    if (!base) continue;
    if (keys.includes(base)) return base;
    if (crop) {
      const prefixed = `${crop}_${base}`;
      if (keys.includes(prefixed)) return prefixed;
    }
  }
  // Suffix match: "red_rot" hits "sugarcane_red_rot" when unambiguous.
  const suffixHits = keys.filter((k) => k === code || k.endsWith(`_${code}`));
  if (suffixHits.length === 1) return suffixHits[0];
  return null;
}

/**
 * Generate an IPM advisory for a given disease, severity, and crop stage.
 *
 * @param {string} diseaseCode - e.g. "rice_blast", "cotton_bollworm"
 * @param {string} severity - "low" | "medium" | "high" | "critical"
 * @param {string} cropStage - "sowing" | "vegetative" | "flowering" | "fruiting" | "maturity" | "harvested"
 * @returns {{ cultural: Array, biological: Array, chemical: Object|null, diseaseCode: string, severity: string }}
 */
export function generateAdvisoryContent(diseaseCode, severity, cropStage = 'vegetative', cropType = '') {
  const rules = loadRules();
  const matchedKey = normalizeDiseaseCode(diseaseCode, cropType, Object.keys(rules.rules || {}))
    || (rules.rules[diseaseCode] ? diseaseCode : null);
  const diseaseRules = matchedKey ? rules.rules[matchedKey] : null;

  if (!diseaseRules) {
    // No rules for this disease — return generic advice
    return {
      cultural: [
        { actionKey: 'general_monitor', en: 'Continue regular field monitoring', 'hi': 'नियमित क्षेत्र निगरानी जारी रखें', 'mr': 'नियमित शेत देखरेख चालू ठेवा' },
        { actionKey: 'consult_expert', en: 'Consult your local agriculture officer', 'hi': 'अपने स्थानीय कृषि अधिकारी से परामर्श करें', 'mr': 'तुमच्या स्थानिक कृषी अधिकाऱ्याशा सल्ला करा' },
      ],
      biological: [],
      chemical: null,
      diseaseCode,
      severity,
      cropStage,
      isGeneric: true,
    };
  }

  // Determine which severity tier to use
  // "critical" uses "high" rules, "low"/"medium"/"high" map directly
  const severityKey = severity === 'critical' ? 'high' : severity;
  const tierRules = diseaseRules[severityKey] || diseaseRules.low || {};

  return {
    cultural: tierRules.cultural || [],
    biological: tierRules.biological || [],
    chemical: tierRules.chemical || null,
    diseaseCode,
    severity,
    cropStage,
    isGeneric: false,
  };
}

/**
 * Generate an advisory for a confirmed diagnosis: Gemini writes it first
 * (new role), falling back to the rule-based advisoryRules.json when the
 * Gemini key is missing or the call fails.
 *
 * @param {string} caseId - ObjectId of the DiagnosisCase
 * @param {string} diseaseCode
 * @param {string} severity - backend tier: "low" | "medium" | "high" | "critical"
 * @param {string} cropStage
 * @param {string} cropType
 * @param {object} [opts] - { confidence: number (0-1), district: string }
 * @returns {Promise<Advisory>}
 */
/**
 * Evaluate spray window clearance from weather conditions.
 *
 * Rules based on standard agricultural extension protocols:
 * - Rain: If >= 5mm in 24h or currently raining, foliage is wet -> "unfavorable" (wash-off risk).
 * - Wind: > 15 km/h (> 4.2 m/s) -> "unfavorable" (severe spray drift risk).
 *         10-15 km/h (2.8 - 4.2 m/s) -> "caution" (moderate drift risk).
 * - Temperature: >= 35°C -> "caution" (droplet evaporation & phytotoxicity scorch risk).
 * - Optimal: 18°C - 30°C, wind < 10 km/h, no rain.
 *
 * @param {object} [weather]
 * @returns {object} sprayWindow
 */
export function calculateSprayWindow(weather = null) {
  const temp = Number.isFinite(Number(weather?.temperatureC)) ? Number(weather.temperatureC) : null;
  const humidity = Number.isFinite(Number(weather?.humidityPct)) ? Number(weather.humidityPct) : null;
  const rain = Number.isFinite(Number(weather?.rainfallMm24h)) ? Number(weather.rainfallMm24h) : 0;
  const windMs = Number.isFinite(Number(weather?.windSpeedMs)) ? Number(weather.windSpeedMs) : null;
  const windKmh = windMs !== null ? Math.round(windMs * 3.6 * 10) / 10 : null;

  let rainRisk = 'none';
  if (rain >= 5) rainRisk = 'high';
  else if (rain > 0.5) rainRisk = 'moderate';

  let windRisk = 'low';
  if (windKmh !== null) {
    if (windKmh > 15) windRisk = 'high';
    else if (windKmh >= 10) windRisk = 'moderate';
  }

  let tempRisk = 'optimal';
  if (temp !== null) {
    if (temp >= 35) tempRisk = 'high';
    else if (temp >= 31 || temp < 12) tempRisk = 'moderate';
  }

  let status = 'favorable';
  let rating = 'Safe to Spray';
  let ratingHi = 'छिड़काव के लिए अनुकूल';
  let ratingMr = 'फवारणीसाठी अनुकूल';
  let reason = 'Weather conditions are optimal for foliar application. Light winds and no rain expected.';
  let reasonHi = 'मौसम की स्थिति छिड़काव के लिए अनुकूल है। हल्की हवा और बारिश का कोई अनुमान नहीं है।';
  let reasonMr = 'हवामान फवारणीसाठी अतिशय अनुकूल आहे. मंद वारा आणि पावसाची शक्यता नाही.';

  if (rainRisk === 'high') {
    status = 'unfavorable';
    rating = 'Postpone Spraying';
    ratingHi = 'छिड़काव स्थगित करें';
    ratingMr = 'फवारणी पुढे ढकला';
    reason = `Recent rainfall (${rain} mm) or wet crop canopy detected. Postpone spraying to prevent chemical wash-off and wastage.`;
    reasonHi = `हालिया बारिश (${rain} मिमी) या गीली पत्तियां पाई गईं। दवा बहने से बचाने के लिए छिड़काव टालें।`;
    reasonMr = `नुकताच पाऊस (${rain} मिमी) किंवा झाडांवर ओलावा आहे. औषध वाहून जाणे टाळण्यासाठी फवारणी पुढे ढकला.`;
  } else if (windRisk === 'high') {
    status = 'unfavorable';
    rating = 'Postpone Spraying';
    ratingHi = 'छिड़काव स्थगित करें';
    ratingMr = 'फवारणी पुढे ढकला';
    reason = `High wind speed (${windKmh} km/h) creates significant spray drift risk. Postpone until winds calm below 12 km/h.`;
    reasonHi = `तेज हवा (${windKmh} किमी/घंटा) से दवा उड़ने का खतरा है। हवा धीमी होने तक छिड़काव रोकें।`;
    reasonMr = `वाऱ्याचा वेग जास्त (${windKmh} किमी/तास) असल्याने औषध उडण्याचा धोका आहे. वारा शांत होईपर्यंत थांबा.`;
  } else if (tempRisk === 'high') {
    status = 'caution';
    rating = 'Spray with Caution';
    ratingHi = 'सावधानी से छिड़काव करें';
    ratingMr = 'काळजीपूर्वक फवारणी करा';
    reason = `High daytime temperature (${temp}°C) causes rapid droplet evaporation and leaf scorch. Spray only in late evening hours.`;
    reasonHi = `अधिक तापमान (${temp}°C) से दवा जल्दी सूख सकती है और पत्तियां जल सकती हैं। केवल देर शाम को छिड़काव करें।`;
    reasonMr = `दुपारचे तापमान जास्त (${temp}°C) असल्याने औषध लवकर सुकते व पाने करपण्याचा धोका असतो. फक्त संध्याकाळी फवारणी करा.`;
  } else if (windRisk === 'moderate' || rainRisk === 'moderate' || tempRisk === 'moderate') {
    status = 'caution';
    rating = 'Spray with Caution';
    ratingHi = 'सावधानी से छिड़काव करें';
    ratingMr = 'काळजीपूर्वक फवारणी करा';
    reason = 'Conditions are borderline. Spray during calm early morning hours using medium droplet nozzles.';
    reasonHi = 'मौसम सामान्य है। सुबह के शांत समय में मध्यम नोजल का प्रयोग करके छिड़काव करें।';
    reasonMr = 'हवामान मध्यम आहे. सकाळी शांत वेळेत मध्यम आकाराचे तुषार वापरून फवारणी करा.';
  }

  return {
    status,
    rating,
    ratingLocalized: { en: rating, hi: ratingHi, mr: ratingMr },
    reason,
    reasonLocalized: { en: reason, hi: reasonHi, mr: reasonMr },
    recommendedTiming: {
      en: 'Early morning (6:30 AM – 9:00 AM) or late evening (4:30 PM – 6:30 PM)',
      hi: 'सुबह (6:30 से 9:00 बजे) या शाम (4:30 से 6:30 बजे)',
      mr: 'सकाळी (6:30 ते 9:00) किंवा संध्याकाळी (4:30 ते 6:30)',
    },
    metrics: {
      temperatureC: temp,
      humidityPct: humidity,
      windSpeedKmh: windKmh,
      windSpeedMs: windMs,
      rainfallMm24h: rain,
    },
    risks: {
      rain: rainRisk,
      wind: windRisk,
      temperature: tempRisk,
    },
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Generate an advisory for a confirmed diagnosis: Gemini writes it first
 * (new role), falling back to the rule-based advisoryRules.json when the
 * Gemini key is missing or the call fails.
 *
 * @param {string} caseId - ObjectId of the DiagnosisCase
 * @param {string} diseaseCode
 * @param {string} severity - backend tier: "low" | "medium" | "high" | "critical"
 * @param {string} cropStage
 * @param {string} cropType
 * @param {object} [opts] - { confidence: number (0-1), district: string, weather: object }
 * @returns {Promise<Advisory>}
 */
export async function generateAdvisoryForCase(caseId, diseaseCode, severity, cropStage = 'vegetative', cropType = '', opts = {}) {
  const sprayWindow = calculateSprayWindow(opts.weather);
  const extra = { sprayWindow, weatherContext: sprayWindow.metrics };

  // 1. Try Gemini first
  const geminiContent = await generateGeminiAdvisoryContent(diseaseCode, severity, cropStage, cropType, opts);
  if (geminiContent) {
    return persistAdvisory(caseId, diseaseCode, severity, cropStage, geminiContent, 'gemini', extra);
  }

  // 2. Fallback to rule-based advisoryRules.json
  const content = generateAdvisoryContent(diseaseCode, severity, cropStage, cropType);
  return persistAdvisory(caseId, diseaseCode, severity, cropStage, content, 'rules', extra);
}

export const REMEDY_TYPE_ORDER = { cultural: 0, physical: 1, biological: 2, chemical: 3 };
const REMEDY_TYPES = ['cultural', 'physical', 'biological', 'chemical'];

// Backend severity (low/medium/high/critical) → prompt severity (mild/moderate/severe)
function toPromptSeverity(severity) {
  const key = String(severity || '').toLowerCase();
  if (key === 'low') return 'mild';
  if (key === 'medium') return 'moderate';
  if (key === 'high' || key === 'critical') return 'severe';
  if (['mild', 'moderate', 'severe'].includes(key)) return key;
  return 'moderate';
}

/**
 * A dosage is concrete only when it contains an actual number + unit
 * (grams/ml per litre or per hectare). Rejects generic guidance like
 * "apply appropriate fungicide" or "use recommended dose".
 */
export function hasConcreteDosage(dosage) {
  if (dosage == null) return false;
  const text = String(dosage).trim();
  if (!text || /^n\/?a$/i.test(text)) return false;
  const lower = text.toLowerCase();
  if (/(appropriate|recommended dose|as per|as required|if needed( alone)?$)/.test(lower)
    && !/\d/.test(text)) return false;
  const hasNumber = /\d+(\.\d+)?/.test(text);
  const hasUnit = /\b(g|grams?|mg|ml|millilitres?|milliliters?|l|litres?|liters?|kg|quintal|tonne|ppm|%|per|ha|hectare)\b/i.test(text);
  return hasNumber && hasUnit;
}

function buildAdvisoryPrompt({ crop, diseaseCode, confidence, severity, cropStage, district, weather }) {
  const confStr = (confidence == null || Number.isNaN(Number(confidence)))
    ? 'unknown'
    : String(Math.round(Number(confidence) * 100) / 100);

  let weatherLine = '';
  if (weather) {
    const parts = [];
    if (weather.temperatureC != null) parts.push(`Temperature: ${weather.temperatureC}°C`);
    if (weather.humidityPct != null) parts.push(`Humidity: ${weather.humidityPct}%`);
    if (weather.windSpeedMs != null) parts.push(`Wind speed: ${Math.round(weather.windSpeedMs * 3.6)} km/h`);
    if (weather.rainfallMm24h != null) parts.push(`24h Rain: ${weather.rainfallMm24h} mm`);
    if (parts.length > 0) {
      weatherLine = `\n- Current ambient weather: ${parts.join(', ')}`;
    }
  }

  return `You are an agricultural extension advisor for Maharashtra, India, writing advisories to the standard of TNAU Agritech and ICAR KVK crop protection guides.
Your advice must be farmer-friendly, clear, and actionable in the field:
- Give specific, practical causal organism and clear field symptoms that a farmer can easily identify on plants.
- For chemical and biological remedies, always provide the exact product/fungicide name, exact concentration, and quantity per litre or hectare (e.g. "1g per litre of water"). Never write vague advice like "apply appropriate fungicide" or "use recommended dose".
- For cultural, mechanical, and sanitation actions (such as field cleanup, crop rotation, seed spacing), set "product_name": "" and "dosage": "" (do not write "N/A" or "None").
- Avoid overly academic botanical jargon. Keep instructions direct, encouraging, and easy for smallholder farmers to execute.

Given:
- Crop: ${crop || 'unknown'}
- Confirmed diagnosis: ${diseaseCode} (confidence: ${confStr})
- Severity: ${severity}
- Growth stage: ${cropStage || 'vegetative'}
- District: ${district || 'unknown'}${weatherLine}

Return ONLY valid JSON (no markdown, no preamble) matching this schema:
{
  "summary": string,
  "pathogen_name": string,
  "symptoms": string,
  "severity": "mild" | "moderate" | "severe",
  "remedies": [
    {
      "type": "cultural" | "physical" | "biological" | "chemical",
      "action": string,
      "product_name": string,
      "dosage": string,
      "frequency": string,
      "timing": string,
      "pre_harvest_interval_days": number | null,
      "safety_notes": string
    }
  ],
  "follow_up_days": number,
  "escalate_to_cropsap": boolean,
  "escalation_reason": string | null
}

Order remedies: cultural, then physical, then biological, then chemical. Only include chemical remedies if severity is "moderate" or "severe". Base every dosage, frequency, and timing on standard Tamil Nadu Agricultural University / ICAR / Maharashtra KVK crop protection recommendations for this exact crop-disease pair — match their level of specificity, for example:

Reference style (red rot in sugarcane, for calibration only — do not reuse this content for unrelated diagnoses):
{
  "pathogen_name": "Glomerella tucumanensis (syn. Colletotrichum falcatum)",
  "symptoms": "Reddening of internal stem tissue with white patches visible when cane is split lengthwise; sour alcohol smell; leaves dry up from top downward.",
  "remedies": [
    {"type": "cultural", "action": "Use disease-free setts from a certified healthy nursery", "product_name": "", "dosage": "", "frequency": "At planting", "timing": "Before sett selection", "pre_harvest_interval_days": null, "safety_notes": "Rotate affected field with rice for 1 season, other crops for 2 seasons"},
    {"type": "physical", "action": "Soil drenching at base of affected clumps", "product_name": "Carbendazim 50 WP", "dosage": "1g per litre of water", "frequency": "Once at first sign of disease", "timing": "Early stage, before spread", "pre_harvest_interval_days": null, "safety_notes": "Remove and burn affected clumps first"},
    {"type": "chemical", "action": "Sett treatment before planting", "product_name": "Carbendazim 50 WP", "dosage": "0.5g per litre of water, with 2.5kg urea per 250 litres", "frequency": "Single pre-plant dip", "timing": "Dip setts 18 minutes at 52°C", "pre_harvest_interval_days": null, "safety_notes": "Ensure water temperature is controlled precisely; overheating damages setts"}
  ]
}

Match this density, farmer clarity, and specificity for the actual crop-disease pair given above.`;
}

/**
 * Validate + normalize parsed Gemini output. Returns { ok, content?, reason? }.
 * - Requires non-empty pathogen_name and symptoms (the causal-organism cite).
 * - Enforces remedy ordering cultural → physical → biological → chemical.
 * - Drops chemical remedies when severity is mild.
 * - Requires a concrete number+unit dosage whenever a product is named
 *   (product_name other than N/A/empty).
 */
export function validateGeminiAdvisory(parsed, promptSeverity) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'empty response' };
  const pathogenName = String(parsed.pathogen_name ?? parsed.pathogenName ?? '').trim();
  const symptoms = String(parsed.symptoms ?? '').trim();
  if (!pathogenName) return { ok: false, reason: 'missing pathogen_name' };
  if (!symptoms) return { ok: false, reason: 'missing symptoms' };
  let remedies = Array.isArray(parsed.remedies) ? parsed.remedies : null;
  if (!remedies || remedies.length === 0) return { ok: false, reason: 'missing remedies' };

  const cleanNA = (v) => (!v || /^(n\/?a|none|nil|-|not applicable)$/i.test(String(v).trim())) ? '' : String(v).trim();

  const normalized = [];
  for (const r of remedies) {
    if (!r || typeof r !== 'object') continue;
    const type = String(r.type || '').toLowerCase().trim();
    if (!REMEDY_TYPES.includes(type)) continue;
    if (promptSeverity === 'mild' && type === 'chemical') continue; // spec: no chemical on mild
    const rawProduct = String(r.product_name ?? r.productName ?? '').trim();
    const rawDosage = String(r.dosage ?? '').trim();
    const needsConcreteDosage = rawProduct && !/^n\/?a$/i.test(rawProduct);
    if (needsConcreteDosage && !hasConcreteDosage(rawDosage)) {
      return { ok: false, reason: `generic dosage for ${type}: "${rawDosage || '(empty)'}"` };
    }
    normalized.push({
      type,
      action: String(r.action ?? '').trim(),
      productName: cleanNA(rawProduct),
      dosage: cleanNA(rawDosage),
      frequency: cleanNA(r.frequency),
      timing: cleanNA(r.timing),
      preHarvestIntervalDays: r.pre_harvest_interval_days ?? r.preHarvestIntervalDays ?? null,
      safetyNotes: String(r.safety_notes ?? r.safetyNotes ?? '').trim(),
    });
  }
  if (normalized.length === 0) return { ok: false, reason: 'no valid remedies after filtering' };
  normalized.sort((a, b) => REMEDY_TYPE_ORDER[a.type] - REMEDY_TYPE_ORDER[b.type]);

  const sev = String(parsed.severity || promptSeverity || 'moderate').toLowerCase();
  return {
    ok: true,
    content: {
      summary: String(parsed.summary ?? '').trim(),
      pathogenName,
      symptoms,
      severityDisplay: ['mild', 'moderate', 'severe'].includes(sev) ? sev : promptSeverity,
      remedies: normalized,
      followUpDays: Number.isFinite(Number(parsed.follow_up_days ?? parsed.followUpDays))
        ? Number(parsed.follow_up_days ?? parsed.followUpDays) : null,
      escalateToCropsap: Boolean(parsed.escalate_to_cropsap ?? parsed.escalateToCropsap ?? false),
      escalationReason: parsed.escalation_reason ?? parsed.escalationReason ?? null,
      prevention: Array.isArray(parsed.prevention) ? parsed.prevention : [],
    },
  };
}

// NOTE: `pre_harvest_interval_days` and `escalation_reason` are frequently
// null (see the red-rot reference: soil drenches carry no PHI). They must be
// `nullable`, otherwise the API rejects every response that sets them null
// and every advisory silently falls back to generic rules content.
const GEMINI_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    pathogen_name: { type: 'string', description: 'Causal organism, e.g. Glomerella tucumanensis' },
    symptoms: { type: 'string', description: '2-4 sentence field-identifiable description' },
    severity: { type: 'string', enum: ['mild', 'moderate', 'severe'] },
    remedies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['cultural', 'physical', 'biological', 'chemical'] },
          action: { type: 'string' },
          product_name: { type: 'string' },
          dosage: { type: 'string', description: 'Real concentration, e.g. 1g per litre of water' },
          frequency: { type: 'string' },
          timing: { type: 'string', description: 'Include duration/temperature when needed' },
          pre_harvest_interval_days: { type: 'number', nullable: true },
          safety_notes: { type: 'string' },
        },
        required: ['type', 'action'],
      },
    },
    follow_up_days: { type: 'number', nullable: true },
    escalate_to_cropsap: { type: 'boolean' },
    escalation_reason: { type: 'string', nullable: true },
  },
  required: ['remedies'],
};

/**
 * Extract a JSON object from free-form model text. Tries (in order): raw
 * parse, fence-stripped parse, greedy brace match, and truncated-JSON
 * repair (brace/bracket closing). Throws on total failure.
 */
export function extractAdvisoryJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Empty response from Gemini');
  const candidates = [];
  candidates.push(raw);
  candidates.push(raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim());
  const greedy = raw.match(/{[\s\S]*}/);
  if (greedy) candidates.push(greedy[0]);
  for (const c of candidates) {
    try {
      if (c) return JSON.parse(c);
    } catch { /* try next */ }
  }
  // Truncated-JSON repair: simulate a bracket stack (string-aware) over the
  // source and emit closers in LIFO order, so `{"a":[{...` → `{"a":[{...}]}`.
  // Falls back to simple counting when the scan itself looks inconsistent.
  const repairSource = greedy ? greedy[0] : (raw.includes('{') ? raw.slice(raw.indexOf('{')) : null);
  if (repairSource) {
    const fixed = closeTruncatedJson(repairSource);
    return JSON.parse(fixed);
  }
  throw new Error('No JSON payload found in response');
}

/**
 * Close unbalanced brackets/braces (and a trailing open string) in
 * truncated model output. String-aware: braces inside quotes are ignored.
 */
export function closeTruncatedJson(text) {
  let fixed = String(text || '').replace(/,\s*$/, '');
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const ch of fixed) {
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') { stack.push(ch); continue; }
    if ((ch === '}' || ch === ']') && stack.length > 0) stack.pop();
  }
  if (inString) fixed += '"';
  while (stack.length > 0) fixed += stack.pop() === '{' ? '}' : ']';
  return fixed;
}

/**
 * Ask Gemini to write the advisory for a specific disease. Returns null on
 * any failure (or on generic dosages after one retry) so the caller falls
 * back to the rule-based content.
 */
async function generateGeminiAdvisoryContent(diseaseCode, severity, cropStage, cropType, opts = {}) {
  if (!genAI) return null;
  const promptSeverity = toPromptSeverity(severity);
  const basePrompt = buildAdvisoryPrompt({
    crop: cropType,
    diseaseCode,
    confidence: opts.confidence,
    severity: promptSeverity,
    cropStage,
    district: opts.district,
    weather: opts.weather,
  });
  const prompts = [
    basePrompt,
    `${basePrompt}\n\nIMPORTANT CORRECTION: your previous draft used a vague dosage. Every remedy with a named product MUST include a real concentration with a number and unit (e.g. "1g per litre of water", "2.5kg urea per 250 litres", "dip 18 minutes at 52\u00b0C"). Never write "apply appropriate fungicide", "recommended dose", or "as per guidance".`,
  ];

  // ── Model waterfall: for each prompt attempt, try every model before giving up.
  for (let attempt = 0; attempt < prompts.length; attempt++) {
    for (const modelName of ADVISORY_MODELS) {
      const model = genAI.getGenerativeModel({ model: modelName });
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(new Error(`Advisory timeout (${modelName})`)), ADVISORY_TIMEOUT_MS);
      try {
        console.log(`[advisory] Trying model: ${modelName} (attempt ${attempt + 1})`);
        const result = await model.generateContent(
          {
            contents: [{ role: 'user', parts: [{ text: prompts[attempt] }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: GEMINI_RESPONSE_SCHEMA,
            },
          },
          { signal: abortController.signal },
        );
        clearTimeout(timeoutId);
        const text = result.response.text ? result.response.text() : '';
        if (!text) continue;
        let parsed;
        try {
          parsed = extractAdvisoryJson(text);
        } catch (parseErr) {
          console.warn(`[advisory] ${modelName} unparseable: ${parseErr.message}`);
          continue;
        }
        const checked = validateGeminiAdvisory(parsed, promptSeverity);
        if (checked.ok) {
          console.log(`[advisory] Success with ${modelName}`);
          return checked.content;
        }
        console.warn(`[advisory] ${modelName} attempt ${attempt + 1} rejected: ${checked.reason}`);
        break; // bad content — retry with next prompt, not next model
      } catch (err) {
        clearTimeout(timeoutId);
        const msg = err.message || '';
        const isRetriable = msg.includes('503') || msg.includes('Service Unavailable') ||
          msg.includes('high demand') || msg.includes('429') ||
          msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('404') || msg.includes('Not Found') ||
          msg.includes('no longer available') || msg.includes('timeout') ||
          msg.includes('aborted') || msg.includes('500');
        if (isRetriable) {
          console.warn(`[advisory] ${modelName} transient error (${msg.slice(0, 100)}) — trying next model in waterfall`);
          continue; // try next model in waterfall
        }
        if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid') || msg.includes('401')) {
          console.warn(`[advisory] Fatal API key error with ${modelName}: ${msg} — using rule fallback`);
          return null;
        }
        console.warn(`[advisory] ${modelName} error (${msg.slice(0, 100)}) — trying next model in waterfall`);
        continue;
      }
    }
  }
  return null;
}

/**
 * Persist an advisory document (shared by the Gemini and rule paths).
 * Dual-write: new remedies[] (+ pathogen/symptoms/follow-up/escalation)
 * are stored alongside the legacy tier fields so old readers keep working.
 */
async function persistAdvisory(caseId, diseaseCode, severity, cropStage, content, source, extra = {}) {
  // Check if advisory already exists for this case
  const existing = await Advisory.findOne({ caseId }).sort({ version: -1 });
  const version = existing ? existing.version + 1 : 1;

  const toActions = (items, prefix) => (items || []).map((text, i) => {
    // If input is a string, use it as English text
    if (typeof text === 'string') {
      return { actionKey: `${prefix}_${i + 1}`, en: text, hi: '', mr: '' };
    }
    // If input is an object with language keys, preserve all translations
    if (text && typeof text === 'object') {
      return {
        actionKey: text.actionKey || `${prefix}_${i + 1}`,
        en: text.en || '',
        hi: text.hi || '',
        mr: text.mr || '',
      };
    }
    return { actionKey: `${prefix}_${i + 1}`, en: '', hi: '', mr: '' };
  });

  const remedyToActionText = (r) => {
    const parts = [r.action || ''];
    if (r.productName && !/^n\/?a$/i.test(r.productName)) {
      parts.push(`${r.productName}${r.dosage ? `, ${r.dosage}` : ''}`);
    }
    if (r.timing) parts.push(`Timing: ${r.timing}`);
    if (r.frequency) parts.push(`Frequency: ${r.frequency}`);
    if (r.safetyNotes) parts.push(`Note: ${r.safetyNotes}`);
    return parts.filter(Boolean).join(' — ');
  };

  let ipmCulturalActions;
  let ipmBiologicalActions;
  let chemicalRecommendation;
  let remedies = [];
  let summary = '';
  let pathogenName = '';
  let symptoms = '';
  let followUpDays = null;
  let escalateToCropsap = false;
  let escalationReason = null;
  let prevention = [];

  const sprayWindow = extra.sprayWindow || content.sprayWindow || null;
  const weatherContext = extra.weatherContext || content.weatherContext || null;

  if (Array.isArray(content.remedies)) {
    // Gemini (new) shape — derive legacy tiers so old clients keep working.
    // Physical has no legacy tier; it folds into cultural ("Cultural &
    // Mechanical" label already covers mechanical/destructive interventions).
    remedies = content.remedies;
    const byType = (t) => remedies.filter((r) => r.type === t);
    ipmCulturalActions = toActions(
      [...byType('cultural'), ...byType('physical')].map(remedyToActionText),
      'cultural',
    );
    ipmBiologicalActions = toActions(byType('biological').map(remedyToActionText), 'biological');
    const firstChemical = byType('chemical')[0] || null;
    chemicalRecommendation = firstChemical ? {
      productClass: firstChemical.productName || '',
      dosage: firstChemical.dosage || '',
      unit: 'water',
      frequency: firstChemical.frequency || '',
      applicationTiming: firstChemical.timing || '',
      preHarvestIntervalDays: firstChemical.preHarvestIntervalDays ?? null,
    } : null;
    summary = content.summary || '';
    pathogenName = content.pathogenName || '';
    symptoms = content.symptoms || '';
    followUpDays = content.followUpDays ?? null;
    escalateToCropsap = Boolean(content.escalateToCropsap);
    escalationReason = content.escalationReason ?? null;
    prevention = Array.isArray(content.prevention) ? content.prevention : [];
  } else {
    // Rules (legacy) shape — persist legacy as today, synthesize remedies[]
    // so the new detail page has a single source to render.
    ipmCulturalActions = toActions(content.cultural, 'cultural');
    ipmBiologicalActions = toActions(content.biological, 'biological');
    chemicalRecommendation = content.chemical || null;
    remedies = synthesizeRemediesFromRules(content);
    prevention = Array.isArray(content.prevention) ? content.prevention : [];
  }

  if (sprayWindow || weatherContext) {
    chemicalRecommendation = chemicalRecommendation || {};
    if (sprayWindow) chemicalRecommendation.sprayWindow = sprayWindow;
    if (weatherContext) chemicalRecommendation.weatherContext = weatherContext;
  }

  const advisory = await Advisory.create({
    caseId,
    version,
    diseaseCode,
    severity,
    cropStage,
    ipmCulturalActions,
    ipmBiologicalActions,
    chemicalRecommendation,
    sprayWindow,
    weatherContext,
    prevention,
    summary,
    pathogenName,
    symptoms,
    remedies,
    followUpDays,
    escalateToCropsap,
    escalationReason,
    source,
    isGeneric: source === 'rules' ? Boolean(content.isGeneric) : false,
    generatedAt: new Date(),
  });
  console.log(`Advisory v${version} saved for case ${caseId} (source: ${source})`);
  return advisory;
}

/**
 * Build a remedies[] array from legacy rules content so rule-fallback
 * advisories render on the new detail page through the same code path.
 * Exported for the regenerate controller, which persists without
 * persistAdvisory().
 */
export function synthesizeRemediesFromRules(content) {
  const synth = [];
  (content.cultural || []).forEach((t) => {
    const en = typeof t === 'string' ? t : (t?.en || '');
    if (en) synth.push({ type: 'cultural', action: en, productName: '', dosage: '', frequency: '', timing: '', preHarvestIntervalDays: null, safetyNotes: '' });
  });
  (content.biological || []).forEach((t) => {
    const en = typeof t === 'string' ? t : (t?.en || '');
    if (en) synth.push({ type: 'biological', action: en, productName: '', dosage: '', frequency: '', timing: '', preHarvestIntervalDays: null, safetyNotes: '' });
  });
  if (content.chemical) {
    synth.push({
      type: 'chemical',
      action: content.chemical.productClass || '',
      productName: content.chemical.productClass || '',
      dosage: [content.chemical.dosage, content.chemical.unit].filter(Boolean).join(' '),
      frequency: content.chemical.frequency || '',
      timing: content.chemical.applicationTiming || '',
      preHarvestIntervalDays: content.chemical.preHarvestIntervalDays ?? null,
      safetyNotes: '',
    });
  }
  return synth;
}

/**
 * Rule-based advisory (advisoryRules.json) — kept as the fallback path.
 */
export async function generateAndSaveAdvisory(caseId, diseaseCode, severity, cropStage = 'vegetative', cropType = '') {
  const content = generateAdvisoryContent(diseaseCode, severity, cropStage, cropType);
  return persistAdvisory(caseId, diseaseCode, severity, cropStage, content, 'rules');
}

/**
 * Get latest advisory for a case.
 */
export async function getAdvisoryForCase(caseId) {
  return Advisory.findOne({ caseId }).sort({ version: -1 }).lean();
}

/**
 * Get advisory in a specific language.
 */
export function localizeAdvisory(advisory, lang = 'en') {
  if (!advisory) return null;

  const localizeActions = (actions) =>
    actions.map(a => ({
      actionKey: a.actionKey,
      text: a[lang] || a.en || '',
    }));

  return {
    ...advisory,
    ipmCulturalActions: localizeActions(advisory.ipmCulturalActions || []),
    ipmBiologicalActions: localizeActions(advisory.ipmBiologicalActions || []),
  };
}
