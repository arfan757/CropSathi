/**
 * minimaxService.js — Minimax M3 via OpenRouter fallback layer.
 *
 * Used as fallback when Gemini fails or returns malformed output.
 * Applies to: disease classification, CNN structuring, advisory generation.
 *
 * OpenRouter docs: https://openrouter.ai/docs
 * Minimax/MiniMax: https://openrouter.ai/models/minimax/minimax-m3
 */

import axios from 'axios';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const MINIMAX_MODEL = 'minimax/minimax-m3:free';
const MINIMAX_TIMEOUT_MS = 90_000; // 90 s
const MAX_RETRIES = 2;            // retry up to 2× on any failure

// ---------------------------------------------------------------------------
// Low-level HTTP call — retries on network errors, HTTP errors, AND JSON
// truncation/parse failures
// ---------------------------------------------------------------------------

/**
 * Call OpenRouter with the given prompt + optional image.
 * Retries up to MAX_RETRIES times on ANY failure.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {string|null} imageBase64 - JPEG image as base64 (no data-URL prefix)
 * @returns {Promise<object>} parsed JSON response
 */
async function callOpenRouter(systemPrompt, userPrompt, imageBase64 = null) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set in .env');
  }

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await _singleAttempt(systemPrompt, userPrompt, imageBase64);
      if (attempt > 1) {
        console.log(`[minimaxService] Success on attempt ${attempt}`);
      }
      return result;
    } catch (err) {
      const isLast = attempt > MAX_RETRIES;
      const retryable =
        err.message?.includes('timeout') ||
        err.message?.includes('ECONNREFUSED') ||
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('ENOTFOUND') ||
        err.message?.includes('JSON') ||
        err.message?.includes('parse') ||
        err.message?.includes('truncated') ||
        err.message?.includes('incomplete') ||
        err.message?.includes('Provider returned error') ||
        err.message?.includes('Unexpected') ||
        err.message?.includes('No JSON') ||
        err.message?.includes('after repair') ||
        err.message?.includes('status code 5') ||
        err.message?.includes('status code 4') ||
        err.message?.includes('429') ||
        err.message?.includes('500') ||
        err.message?.includes('502') ||
        err.message?.includes('503');

      if (isLast || !retryable) {
        console.error(`[minimaxService] Final attempt (${attempt}) failed: ${err.message}`);
        throw err;
      }
      console.warn(`[minimaxService] Attempt ${attempt} failed (${err.message}) — retrying...`);
    }
  }
}

/** One HTTP attempt — throws on network/HTTP/JSON failure. */
async function _singleAttempt(systemPrompt, userPrompt, imageBase64) {
  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: imageBase64
        ? [
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
            },
            { type: 'text', text: userPrompt },
          ]
        : userPrompt,
    },
  ];

  // Use response_format=json_object for cleaner JSON from the model.
  // Minimax M3 supports structured outputs via response_format per OpenRouter docs.
  // (No `reasoning` parameter for this model — keep it simple.)
  const body = {
    model: MINIMAX_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: 4096,
    response_format: { type: 'json_object' },
  };

  let response;
  try {
    response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.CORS_ORIGIN || 'http://localhost:3000',
          'X-Title': 'CropSathi',
        },
        timeout: MINIMAX_TIMEOUT_MS,
      }
    );
  } catch (networkErr) {
    // Wrap for retry detection
    const detail = networkErr.response?.data?.error?.message || networkErr.message;
    throw new Error(`network_error: ${detail}`);
  }

  // HTTP-level errors from OpenRouter
  if (response.status !== 200) {
    const errMsg = response.data?.error?.message || `HTTP ${response.status}`;
    throw new Error(`http_error: ${errMsg}`);
  }

  const raw = response.data?.choices?.[0]?.message?.content ?? '';
  return parseJsonResponse(raw);
}

/** Pull valid JSON from a response that may have markdown fences or be truncated. */
function parseJsonResponse(raw) {
  // Strip markdown fences and surrounding whitespace
  let text = String(raw || '')
    .replace(/^[`\s]+|[`\s]+$/g, '')
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/\s*```$/im, '')
    .trim();

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch (_) { /* fall through */ }

  // Repair truncated JSON
  const fixed = fixTruncatedJson(text);
  try {
    return JSON.parse(fixed);
  } catch (err) {
    throw new Error(`JSON parse failed after repair: ${err.message} | raw: ${text.substring(0, 300)}`);
  }
}

/** Heuristic repair for truncated JSON responses. */
function fixTruncatedJson(text) {
  if (!text) return '{}';

  // Extract from first { to last }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in response');
  }

  let fixed = text.substring(start, end + 1);

  // Remove trailing incomplete value (e.g. "notes": "partial te...)
  fixed = fixed.replace(/,(\s*[}\]]+)+$/, (m) => m.replace(/,/g, ''));
  fixed = fixed.replace(/,\s*["'][^"']*$/, '');

  // Balance open braces
  const openCurly = (fixed.match(/{/g) || []).length;
  const closeCurly = (fixed.match(/}/g) || []).length;
  for (let i = 0; i < openCurly - closeCurly; i++) fixed += '}';

  // Balance open brackets
  const openBracket = (fixed.match(/\[/g) || []).length;
  const closeBracket = (fixed.match(/\]/g) || []).length;
  for (let i = 0; i < openBracket - closeBracket; i++) fixed += ']';

  // Balance quotes: if odd number of quotes, remove trailing unclosed string
  const quoteCount = (fixed.match(/"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    const lastComplete = fixed.lastIndexOf(',');
    if (lastComplete > 0) {
      fixed = fixed.substring(0, lastComplete) + '}';
    }
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Public helpers — used by diagnosisService.js and advisoryService.js
// ---------------------------------------------------------------------------

/**
 * System prompt for disease classification (image + optional risk context).
 */
export const DISEASE_CLASSIFICATION_SYSTEM = `You are an expert agricultural pathologist diagnosing crop diseases in Maharashtra, India. You are helping a smallholder farmer with a smartphone. Be specific with product names, dosages, and timings. Always respond with ONLY raw JSON — no markdown, no explanation, no preamble. Output this exact JSON structure:
{
  "image_quality_ok": boolean,
  "crop_identified": string,
  "detected_issue": string,
  "confidence": number,
  "severity": "none"|"mild"|"moderate"|"severe",
  "symptoms_observed": string[],
  "matches_risk_signal": boolean,
  "disease_description": string,
  "treatment": {
    "immediate_actions": string[],
    "chemical": string,
    "biological": string,
    "cultural": string,
    "application_schedule": string,
    "withholding_period": string
  },
  "prevention": string[],
  "notes": string
}
If the photo is blurry/dark/distant, set image_quality_ok to false. If the crop looks healthy, set detected_issue to "healthy" and severity to "none".`;

/**
 * System prompt for structuring CNN results (no image — text-only).
 */
export const CNN_STRUCTURE_SYSTEM = `You are a plant disease data-normalization assistant. Given the raw output from a PlantVillage CNN model, normalize it into the standard CropSathi diagnosis JSON format. Always respond with ONLY raw JSON — no markdown, no explanation.
{
  "image_quality_ok": boolean,
  "crop_identified": string,
  "detected_issue": string,
  "confidence": number,
  "severity": "none"|"mild"|"moderate"|"severe",
  "symptoms_observed": string[],
  "matches_risk_signal": boolean,
  "disease_description": string,
  "treatment": {
    "immediate_actions": string[],
    "chemical": string,
    "biological": string,
    "cultural": string,
    "application_schedule": string,
    "withholding_period": string
  },
  "prevention": string[],
  "notes": string
}`;

/**
 * System prompt for advisory generation (text-only, no image).
 */
export const ADVISORY_SYSTEM = `You are an expert IPM (Integrated Pest Management) agronomist advising a farmer in Maharashtra, India. Give specific, practical advice for the identified disease/issue. Always respond with ONLY raw JSON — no markdown, no explanation.
{
  "cultural": string[],
  "biological": string[],
  "chemical": {
    "productClass": string,
    "dosage": string,
    "unit": string,
    "frequency": string,
    "applicationTiming": string,
    "preHarvestIntervalDays": number
  },
  "prevention": string[]
}
If no chemical treatment is warranted, set chemical to null. Provide pre-harvest interval in days.`;

/**
 * Classify a disease from an image via Minimax.
 *
 * @param {string} imageBase64   - JPEG image as base64 (no data-URL prefix)
 * @param {string} cropType      - crop name (e.g. "potato")
 * @param {string} cropStage     - growth stage (e.g. "vegetative")
 * @param {string} [riskContext] - optional risk context string
 * @returns {Promise<object>}    - parsed diagnosis JSON
 */
export async function classifyDisease(
  imageBase64,
  cropType,
  cropStage = 'vegetative',
  riskContext = ''
) {
  const userPrompt = riskContext
    ? `CROP: ${cropType} (growth stage: ${cropStage})\nRISK CONTEXT: ${riskContext}\n\nAnalyze the photo(s) and return the diagnosis JSON.`
    : `CROP: ${cropType} (growth stage: ${cropStage})\n\nAnalyze the photo(s) and return the diagnosis JSON.`;

  return callOpenRouter(DISEASE_CLASSIFICATION_SYSTEM, userPrompt, imageBase64);
}

/**
 * Structure a raw CNN prediction into the standard diagnosis JSON.
 *
 * @param {string}   cnnClassName  - e.g. "Potato___Early_blight"
 * @param {number}   confidence    - 0–1
 * @param {string[]} topK          - top-5 class names
 * @param {string}   cropType      - farm crop type
 * @returns {Promise<object>}       - parsed structured JSON
 */
export async function structureCnnResult(cnnClassName, confidence, topK = [], cropType = '') {
  const topKStr = topK
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n');

  const userPrompt =
    'Given this raw PlantVillage CNN output, normalize it to CropSathi format:\n\n' +
    `CNN class: ${cnnClassName}\n` +
    `Confidence: ${confidence}\n` +
    `Top-5 classes:\n${topKStr}\n` +
    `Farm crop type: ${cropType || 'unknown'}\n\n` +
    'Return the normalized diagnosis JSON.';

  return callOpenRouter(CNN_STRUCTURE_SYSTEM, userPrompt, null);
}

/**
 * Generate an IPM advisory via Minimax.
 *
 * @param {string} diseaseCode - e.g. "rice_blast"
 * @param {string} severity    - "low"|"medium"|"high"|"critical"
 * @param {string} cropStage  - growth stage
 * @param {string} cropType   - crop name
 * @returns {Promise<object>} - parsed advisory JSON
 */
export async function generateAdvisory(diseaseCode, severity, cropStage, cropType) {
  const userPrompt =
    `CROP: ${cropType || 'unknown'}\n` +
    `DISEASE: ${diseaseCode}\n` +
    `SEVERITY: ${severity}\n` +
    `GROWTH STAGE: ${cropStage}\n\n` +
    'Return the advisory JSON.';

  return callOpenRouter(ADVISORY_SYSTEM, userPrompt, null);
}
