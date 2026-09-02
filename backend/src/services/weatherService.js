import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import WeatherReading from '../models/WeatherReading.js';
import Field from '../models/Field.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

// ─── Weather Rules (cached at startup) ─────────────────────────────────────
let weatherRules = null;

function loadWeatherRules() {
  if (weatherRules) return weatherRules;
  try {
    const rulesPath = join(__dirname, '../config/weatherRules.json');
    const raw = readFileSync(rulesPath, 'utf-8');
    weatherRules = JSON.parse(raw);
    console.log(`📋 Loaded weather rules v${weatherRules.version} (${Object.keys(weatherRules.rules).length} crops)`);
    return weatherRules;
  } catch (err) {
    console.error('⚠️  Failed to load weather rules:', err.message);
    weatherRules = { rules: {}, defaultThresholds: { humidityMin: 70, tempMin: 18, tempMax: 30, rainfallMin: 5, windSpeedMin: 0, soilTempMin: 15, soilTempMax: 35, riskWeight: 0.5, severityBands: { low: 0.2, medium: 0.45, high: 0.65 } } };
    return weatherRules;
  }
}

// Load rules eagerly at module import
loadWeatherRules();

// ─── Open-Meteo Client ─────────────────────────────────────────────────────

export async function fetchWeatherFromOpenMeteo(lat, lng) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lng,
    current: 'temperature_2m,relative_humidity_2m,rain,soil_temperature_6cm,wind_speed_10m',
    timezone: 'auto',
  });

  const response = await fetch(`${OPEN_METEO_BASE}?${params}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo error: ${response.status}`);
  }
  return response.json();
}

// ─── Weather Polling ───────────────────────────────────────────────────────

export async function pollWeatherForFarm(farm) {
  const lat = farm.centerLat || (farm.polygon?.[0]?.lat);
  const lng = farm.centerLng || (farm.polygon?.[0]?.lng);

  if (!lat || !lng) {
    throw new Error(`Farm ${farm._id} has no coordinates`);
  }

  const data = await fetchWeatherFromOpenMeteo(lat, lng);
  const current = data.current;

  const reading = await WeatherReading.create({
    farmId: farm._id,
    source: 'open_meteo',
    observedAt: new Date(current.time || Date.now()),
    temperatureC: current.temperature_2m,
    humidityPct: current.relative_humidity_2m,
    rainfallMm24h: current.rain ?? 0,
    windSpeedMs: current.wind_speed_10m,
    soilTempC: current.soil_temperature_6cm,
    rawPayload: data,
  });

  await Field.findByIdAndUpdate(farm._id, { lastWeatherPollAt: new Date() });

  return reading;
}

export async function getRecentWeather(farmId, limit = 10) {
  return WeatherReading.find({ farmId })
    .sort({ observedAt: -1 })
    .limit(limit)
    .lean();
}

// ─── Rule-Based Weather Risk Evaluation (v2) ───────────────────────────────

/**
 * Determine severity band from a raw risk score using the rule's severityBands thresholds.
 * @param {number} rawScore - matched rule riskWeight (0-1)
 * @param {object} severityBands - { low: 0.3, medium: 0.6, high: 0.85 }
 * @returns {string} "low" | "medium" | "high"
 */
function classifySeverity(rawScore, severityBands) {
  if (!severityBands) return rawScore < 0.3 ? 'low' : rawScore < 0.6 ? 'medium' : 'high';
  if (rawScore >= severityBands.high) return 'high';
  if (rawScore >= severityBands.medium) return 'medium';
  return 'low';
}

/**
 * Evaluate weather rules for a crop type against a weather reading (v2).
 * Now includes: wind speed, soil temperature, crop stage filtering, severity bands.
 *
 * Returns { score, severity, matchedRules[], diseaseHypothesis, cropStage }
 */
export function evaluateWeatherRules(weatherReading, cropType, farmCropStage = null) {
  const rules = loadWeatherRules();
  const cropKey = cropType?.toLowerCase();
  const cropRules = rules.rules[cropKey] || [];
  const defaults = rules.defaultThresholds;

  if (!weatherReading) {
    return { score: 0.5, severity: 'medium', matchedRules: [], diseaseHypothesis: null, cropStage: farmCropStage };
  }

  const { humidityPct, temperatureC, rainfallMm24h, windSpeedMs, soilTempC } = weatherReading;

  // Default fallback if crop not in rules
  if (cropRules.length === 0) {
    let score = 0;
    if (humidityPct > defaults.humidityMin) score += 0.25;
    if (temperatureC >= defaults.tempMin && temperatureC <= defaults.tempMax) score += 0.25;
    if (rainfallMm24h > defaults.rainfallMin) score += 0.25;
    if (windSpeedMs >= (defaults.windSpeedMin || 0)) score += 0.1;
    if (soilTempC >= (defaults.soilTempMin || 0) && soilTempC <= (defaults.soilTempMax || 50)) score += 0.1;
    const severity = classifySeverity(score, defaults.severityBands);
    return {
      score: Math.min(score, 1),
      severity,
      matchedRules: [],
      diseaseHypothesis: null,
      cropStage: farmCropStage,
    };
  }

  const matchedRules = [];

  for (const rule of cropRules) {
    const humidityMatch = humidityPct >= rule.humidityMin;
    const tempMatch = temperatureC >= rule.tempMin && temperatureC <= rule.tempMax;
    const rainfallMatch = rainfallMm24h >= rule.rainfallMin;
    const windMatch = windSpeedMs >= (rule.windSpeedMin || 0);
    const soilTempMatch = soilTempC >= (rule.soilTempMin || 0) && soilTempC <= (rule.soilTempMax || 50);

    // Crop stage filter: if rule specifies stages, check if current stage matches
    const stageMatch = !rule.cropStages || rule.cropStages.length === 0 ||
      (farmCropStage && rule.cropStages.includes(farmCropStage));

    // Count how many thresholds are met (out of 6 possible)
    const thresholdsMet = [humidityMatch, tempMatch, rainfallMatch, windMatch, soilTempMatch, stageMatch].filter(Boolean).length;

    // Only match if at least the core 3 (humidity, temp, rainfall) are met
    if (humidityMatch && tempMatch && rainfallMatch) {
      // Scale risk weight by how many additional thresholds are met
      const bonus = (thresholdsMet - 3) * 0.02; // up to +0.06 for all 3 extras
      const adjustedWeight = Math.min(rule.riskWeight + bonus, 1.0);

      matchedRules.push({
        diseaseCode: rule.diseaseCode,
        diseaseName: rule.diseaseName,
        riskWeight: adjustedWeight,
        baseRiskWeight: rule.riskWeight,
        thresholdsMet,
        windMatch,
        soilTempMatch,
        stageMatch,
        notes: rule.notes,
        severityBands: rule.severityBands,
      });
    }
  }

  // Score = average risk weight of matched rules, or 0 if none
  let score = 0;
  let severity = 'low';
  let diseaseHypothesis = null;

  if (matchedRules.length > 0) {
    const totalWeight = matchedRules.reduce((sum, r) => sum + r.riskWeight, 0);
    score = totalWeight / matchedRules.length;
    // Hypothesis = highest-risk matched disease
    const sorted = [...matchedRules].sort((a, b) => b.riskWeight - a.riskWeight);
    diseaseHypothesis = sorted[0].diseaseCode;
    // Use the top matched disease's severity bands
    severity = classifySeverity(score, sorted[0].severityBands);
  }

  return {
    score: Math.min(score, 1),
    severity,
    matchedRules,
    diseaseHypothesis,
    cropStage: farmCropStage,
  };
}

/**
 * Convenience: fetch latest weather + evaluate rules for a farm.
 */
export async function evaluateWeatherForFarm(farmId) {
  const readings = await getRecentWeather(farmId, 1);
  const latest = readings[0] || null;

  const farm = await Field.findById(farmId).lean();
  const cropType = farm?.cropType || 'Other';
  const cropStage = farm?.cropStage || 'vegetative';

  const evaluation = evaluateWeatherRules(latest, cropType, cropStage);

  return {
    weatherReading: latest,
    ...evaluation,
  };
}
