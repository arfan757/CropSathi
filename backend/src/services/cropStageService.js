/**
 * cropStageService.js
 * ───────────────────
 * Infers a field's growth stage from (cropType, sowingDate).
 *
 * WHY THIS EXISTS: Field.cropStage drives health-score weights
 * (vegetationHealth.js STAGE_TO_SCENARIO), NDVI expectations
 * (ndviService.js STAGE_MULTIPLIER) and weather-rule stage gating
 * (weatherService.js) — but no UI ever collected it, so every field
 * silently scored as 'vegetative' forever. This module is the single
 * source of truth for stage inference; the add-field form, the field
 * controller and the health scorer all use it.
 *
 * CALENDAR VALUES are approximate India-season averages in days since
 * sowing, NOT measured from this project's data. NEEDS_CALIBRATION
 * per variety/region/season. A farmer-explicit stage always wins over
 * the inferred one.
 *
 * Perennials (grapes): sowing date does not map to a growth cycle, so
 * they use a generic annual cycle. Still approximate.
 */

// [lo, hi] inclusive day ranges since sowing (UTC-midnight normalized).
export const CROP_STAGE_CALENDAR = {
  wheat:     { sowing: [0, 10],  vegetative: [11, 35],  flowering: [36, 65],  fruiting: [66, 100],  maturity: [101, 130], harvested: [131, Infinity] },
  rice:      { sowing: [0, 10],  vegetative: [11, 45],  flowering: [46, 75],   fruiting: [76, 115],  maturity: [116, 145], harvested: [146, Infinity] },
  maize:     { sowing: [0, 7],   vegetative: [8, 35],   flowering: [36, 55],   fruiting: [56, 85],   maturity: [86, 105],  harvested: [106, Infinity] },
  cotton:    { sowing: [0, 10],  vegetative: [11, 50],  flowering: [51, 90],   fruiting: [91, 140],  maturity: [141, 175], harvested: [176, Infinity] },
  sugarcane: { sowing: [0, 30],  vegetative: [31, 150], flowering: [151, 210], fruiting: [211, 300], maturity: [301, 365], harvested: [366, Infinity] },
  potato:    { sowing: [0, 7],   vegetative: [8, 30],   flowering: [31, 50],   fruiting: [51, 75],   maturity: [76, 95],   harvested: [96, Infinity] },
  grapes:    { sowing: [0, 14],  vegetative: [15, 60],  flowering: [61, 90],   fruiting: [91, 150],  maturity: [151, 180], harvested: [181, Infinity] },
  soybean:   { sowing: [0, 7],   vegetative: [8, 35],   flowering: [36, 55],   fruiting: [56, 85],   maturity: [86, 105],  harvested: [106, Infinity] },
  tur:       { sowing: [0, 10],  vegetative: [11, 60],  flowering: [61, 100],  fruiting: [101, 150], maturity: [151, 180], harvested: [181, Infinity] },
  // Generic fallback for 'Other' and unrecognized crops.
  other:     { sowing: [0, 7],   vegetative: [8, 40],   flowering: [41, 70],   fruiting: [71, 110],  maturity: [111, 140], harvested: [141, Infinity] },
};

export const CROP_STAGES = Object.freeze([
  'sowing',
  'vegetative',
  'flowering',
  'fruiting',
  'maturity',
  'harvested',
]);

function toUtcMidnight(date) {
  const d = new Date(date);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Infer growth stage from crop type + sowing date.
 *
 * @param {string|null} cropType - e.g. 'Cotton' (case-insensitive)
 * @param {string|Date|null} sowingDate - ISO date or Date
 * @param {Date} [now=new Date()] - reference time (injectable for tests)
 * @returns {string|null} stage, or null when it cannot be inferred
 */
export function inferCropStage(cropType, sowingDate, now = new Date()) {
  if (!sowingDate) return null;
  const sown = new Date(sowingDate);
  if (Number.isNaN(sown.getTime())) return null;

  const daysSince = Math.floor((toUtcMidnight(now) - toUtcMidnight(sown)) / 86400000);
  // Future sowing date (data entry ahead of time) → crop not yet sown.
  if (daysSince < 0) return 'sowing';

  const key = (cropType || 'other').toLowerCase();
  const calendar = CROP_STAGE_CALENDAR[key] || CROP_STAGE_CALENDAR.other;

  for (const stage of CROP_STAGES) {
    const [lo, hi] = calendar[stage];
    if (daysSince >= lo && daysSince <= hi) return stage;
  }
  return 'harvested'; // safety net; calendars end with harvested: [N, Infinity]
}

/**
 * Days since sowing (UTC-midnight normalized). Null when unknown.
 */
export function daysSinceSowing(sowingDate, now = new Date()) {
  if (!sowingDate) return null;
  const sown = new Date(sowingDate);
  if (Number.isNaN(sown.getTime())) return null;
  return Math.floor((toUtcMidnight(now) - toUtcMidnight(sown)) / 86400000);
}

/**
 * True when value is a valid Field.cropStage enum member.
 */
export function isValidCropStage(value) {
  return CROP_STAGES.includes(value);
}
