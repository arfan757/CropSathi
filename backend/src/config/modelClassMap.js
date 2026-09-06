/**
 * Mapping between the 38 PlantVillage CNN classes (from
 * goutam-dev/crop-disease-detection, trained_plant_disease_model.keras)
 * and CropSathi disease codes.
 *
 * The CNN only covers 14 plants (apple, blueberry, cherry, corn/maize, grape,
 * orange, peach, pepper, potato, raspberry, soybean, squash, strawberry,
 * tomato). Crops outside that set (rice, cotton, wheat, sugarcane, tur, ...)
 * fall back to Gemini vision in diagnosisService.js.
 */

/** Plants the 38-class CNN can diagnose (app cropType values + aliases). */
export const SUPPORTED_CROPS = [
  'maize', 'grapes', 'potato', 'soybean', 'tomato',
  'apple', 'blueberry', 'cherry', 'orange', 'peach', 'pepper', 'raspberry', 'squash', 'strawberry',
];

/** Alias normalisation for cropType strings farmers may type. */
const CROP_ALIASES = {
  corn: 'maize',
  'corn (maize)': 'maize',
  grape: 'grapes',
  'bell pepper': 'pepper',
};

export function normalizeCrop(cropType) {
  if (!cropType) return '';
  return CROP_ALIASES[String(cropType).trim().toLowerCase()] || String(cropType).trim().toLowerCase();
}

export function isSupportedCrop(cropType) {
  return SUPPORTED_CROPS.includes(normalizeCrop(cropType));
}

/** PlantVillage class name -> CropSathi disease code. 'healthy' for *___healthy. */
export const CLASS_TO_DISEASE = {
  'Apple___Apple_scab': 'apple_scab',
  'Apple___Black_rot': 'apple_black_rot',
  'Apple___Cedar_apple_rust': 'apple_cedar_rust',
  'Apple___healthy': 'healthy',
  'Blueberry___healthy': 'healthy',
  'Cherry_(including_sour)___Powdery_mildew': 'cherry_powdery_mildew',
  'Cherry_(including_sour)___healthy': 'healthy',
  'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot': 'maize_gray_leaf_spot',
  'Corn_(maize)___Common_rust_': 'maize_common_rust',
  'Corn_(maize)___Northern_Leaf_Blight': 'maize_northern_leaf_blight',
  'Corn_(maize)___healthy': 'healthy',
  'Grape___Black_rot': 'grape_black_rot',
  'Grape___Esca_(Black_Measles)': 'grape_esca',
  'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)': 'grape_leaf_blight',
  'Grape___healthy': 'healthy',
  'Orange___Haunglongbing_(Citrus_greening)': 'orange_citrus_greening',
  'Peach___Bacterial_spot': 'peach_bacterial_spot',
  'Peach___healthy': 'healthy',
  'Pepper,_bell___Bacterial_spot': 'pepper_bacterial_spot',
  'Pepper,_bell___healthy': 'healthy',
  'Potato___Early_blight': 'potato_early_blight',
  'Potato___Late_blight': 'potato_late_blight',
  'Potato___healthy': 'healthy',
  'Raspberry___healthy': 'healthy',
  'Soybean___healthy': 'healthy',
  'Squash___Powdery_mildew': 'squash_powdery_mildew',
  'Strawberry___Leaf_scorch': 'strawberry_leaf_scorch',
  'Strawberry___healthy': 'healthy',
  'Tomato___Bacterial_spot': 'tomato_bacterial_spot',
  'Tomato___Early_blight': 'tomato_early_blight',
  'Tomato___Late_blight': 'tomato_late_blight',
  'Tomato___Leaf_Mold': 'tomato_leaf_mold',
  'Tomato___Septoria_leaf_spot': 'tomato_septoria_leaf_spot',
  'Tomato___Spider_mites Two-spotted_spider_mite': 'tomato_spider_mite',
  'Tomato___Target_Spot': 'tomato_target_spot',
  'Tomato___Tomato_Yellow_Leaf_Curl_Virus': 'tomato_yellow_leaf_curl_virus',
  'Tomato___Tomato_mosaic_virus': 'tomato_mosaic_virus',
  'Tomato___healthy': 'healthy',
};

/** Severity bands derived from CNN softmax confidence. */
export function severityFromConfidence(confidence) {
  if (confidence >= 0.95) return 'severe';
  if (confidence >= 0.85) return 'moderate';
  return 'mild';
}

/** 'Potato___Early_blight' -> 'Potato Early Blight' (display text). */
export function humanizeClassName(className) {
  return String(className || '')
    .replace(/\(including_sour\)/g, 'Cherry')
    .replace(/\(maize\)/g, '')
    .replace(/___/g, ' ')
    .replace(/_/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build the same result shape Gemini used to produce, so saveGeminiResult,
 * routeDiagnosis, and the frontend (which reads diagnosisCase.geminiResult)
 * all keep working unchanged.
 */
export function buildCnnResult(prediction, farm = {}) {
  const className = prediction.class_name || '';
  const confidence = Number(prediction.confidence) || 0;
  const topK = Array.isArray(prediction.top_k) ? prediction.top_k : [];
  const diseaseCode = CLASS_TO_DISEASE[className] || className.toLowerCase();
  const healthy = diseaseCode === 'healthy';
  const display = humanizeClassName(className);

  return {
    image_quality_ok: true,
    crop_identified: farm.cropType || String(className.split('___')[0] || '').toLowerCase() || 'unknown',
    detected_issue: healthy ? 'healthy' : diseaseCode,
    confidence: Math.round(confidence * 1000) / 1000,
    severity: healthy ? 'none' : severityFromConfidence(confidence),
    symptoms_observed: healthy ? [] : [display],
    // For the CNN the visual detection itself is the signal: a confident
    // prediction matches, so it routes to 'confirmed' and gets an advisory.
    matches_risk_signal: confidence >= 0.75,
    disease_description: display,
    treatment: { immediate_actions: [], chemical: '', biological: '', cultural: '', application_schedule: '' },
    prevention: [],
    notes: `Detected by PlantVillage CNN (38 classes). Top matches: ${
      topK.slice(0, 3).map((t) => `${humanizeClassName(t.class_name)} (${Math.round((t.confidence || 0) * 100)}%)`).join(', ')
    }.`,
    modelVersion: 'plant-disease-cnn-38',
    _modelSource: 'cnn',
  };
}