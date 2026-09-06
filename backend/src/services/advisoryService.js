import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Advisory from '../models/Advisory.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { generateAdvisory as generateMinimaxAdvisory } from './minimaxService.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;
const ADVISORY_MODEL = 'gemini-3.6-flash';
const ADVISORY_TIMEOUT_MS = 60000;

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
 * Generate an IPM advisory for a given disease, severity, and crop stage.
 *
 * @param {string} diseaseCode - e.g. "rice_blast", "cotton_bollworm"
 * @param {string} severity - "low" | "medium" | "high" | "critical"
 * @param {string} cropStage - "sowing" | "vegetative" | "flowering" | "fruiting" | "maturity" | "harvested"
 * @returns {{ cultural: Array, biological: Array, chemical: Object|null, diseaseCode: string, severity: string }}
 */
export function generateAdvisoryContent(diseaseCode, severity, cropStage = 'vegetative') {
  const rules = loadRules();
  const diseaseRules = rules.rules[diseaseCode];

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
 * @param {string} severity
 * @param {string} cropStage
 * @param {string} cropType
 * @returns {Promise<Advisory>}
 */
export async function generateAdvisoryForCase(caseId, diseaseCode, severity, cropStage = 'vegetative', cropType = '') {
  // 1. Try Gemini first
  const geminiContent = await generateGeminiAdvisoryContent(diseaseCode, severity, cropStage, cropType);
  if (geminiContent) {
    return persistAdvisory(caseId, diseaseCode, severity, cropStage, geminiContent, 'gemini');
  }

  // 2. Fallback to Minimax via OpenRouter
  try {
    const minimaxContent = await generateMinimaxAdvisory(diseaseCode, severity, cropStage, cropType);
    if (minimaxContent) {
      return persistAdvisory(caseId, diseaseCode, severity, cropStage, minimaxContent, 'minimax');
    }
  } catch (minimaxErr) {
    console.warn('[advisoryService] Minimax fallback failed:', minimaxErr.message);
  }

  // 3. Final fallback to rule-based advisoryRules.json
  const content = generateAdvisoryContent(diseaseCode, severity, cropStage);
  return persistAdvisory(caseId, diseaseCode, severity, cropStage, content, 'rules');
}

/**
 * Ask Gemini to write the advisory for a specific disease. Returns null on
 * any failure so the caller falls back to the rule-based content.
 */
async function generateGeminiAdvisoryContent(diseaseCode, severity, cropStage, cropType) {
  if (!genAI) return null;
  const model = genAI.getGenerativeModel({ model: ADVISORY_MODEL });
  const prompt = `You are an expert IPM (Integrated Pest Management) agronomist advising a farmer in Maharashtra, India.
CROP: ${cropType || 'unknown'}
DISEASE: ${diseaseCode}
SEVERITY: ${severity}
GROWTH STAGE: ${cropStage}
Give specific, practical advice: cultural practices / immediate field actions, biological controls, and a chemical treatment (product class with example products, dosage, unit, frequency, timing, and pre-harvest interval in days — null if no chemical is warranted).
Output ONLY raw JSON with these exact keys: cultural, biological, chemical, prevention.`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(new Error('Gemini advisory timeout after 60s')), ADVISORY_TIMEOUT_MS);
  try {
    const result = await model.generateContent(prompt, {
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            cultural: { type: 'array', items: { type: 'string' }, description: 'Cultural practices / immediate field actions' },
            biological: { type: 'array', items: { type: 'string' }, description: 'Biological control methods' },
            chemical: {
              type: ['object', 'null'],
              description: 'Chemical treatment, or null if none recommended',
              properties: {
                productClass: { type: 'string' },
                dosage: { type: 'string' },
                unit: { type: 'string' },
                frequency: { type: 'string' },
                applicationTiming: { type: 'string' },
                preHarvestIntervalDays: { type: 'number' },
              },
              required: ['productClass', 'dosage', 'unit', 'frequency', 'applicationTiming', 'preHarvestIntervalDays'],
            },
            prevention: { type: 'array', items: { type: 'string' }, description: 'Prevention steps for next season' },
          },
          required: ['cultural', 'biological', 'chemical', 'prevention'],
        },
      },
      signal: abortController.signal,
    });
    clearTimeout(timeoutId);
    const text = result.response.text ? result.response.text() : '';
    if (!text) return null;
    const jsonMatch = text.match(/{[\s\S]*}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      cultural: Array.isArray(parsed.cultural) ? parsed.cultural : [],
      biological: Array.isArray(parsed.biological) ? parsed.biological : [],
      chemical: parsed.chemical && typeof parsed.chemical === 'object' ? parsed.chemical : null,
      prevention: Array.isArray(parsed.prevention) ? parsed.prevention : [],
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('Gemini advisory generation failed, using rule fallback:', err.message);
    return null;
  }
}

/**
 * Persist an advisory document (shared by the Gemini and rule paths).
 */
async function persistAdvisory(caseId, diseaseCode, severity, cropStage, content, source) {
  // Check if advisory already exists for this case
  const existing = await Advisory.findOne({ caseId }).sort({ version: -1 });
  const version = existing ? existing.version + 1 : 1;

  const toActions = (items, prefix) => (items || []).map((text, i) => {
    const t = typeof text === 'string' ? text : (text && text.en) || '';
    return { actionKey: `${prefix}_${i + 1}`, en: t, hi: '', mr: '' };
  });

  const advisory = await Advisory.create({
    caseId,
    version,
    diseaseCode,
    severity,
    cropStage,
    ipmCulturalActions: toActions(content.cultural, 'cultural'),
    ipmBiologicalActions: toActions(content.biological, 'biological'),
    chemicalRecommendation: content.chemical || null,
    generatedAt: new Date(),
  });
  console.log(`Advisory v${version} saved for case ${caseId} (source: ${source})`);
  return advisory;
}

/**
 * Rule-based advisory (advisoryRules.json) — kept as the fallback path.
 */
export async function generateAndSaveAdvisory(caseId, diseaseCode, severity, cropStage = 'vegetative') {
  const content = generateAdvisoryContent(diseaseCode, severity, cropStage);
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
