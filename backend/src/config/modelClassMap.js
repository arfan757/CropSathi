/**
 * Mapping between CropSathi ML models:
 * 1. Tier A ONNX model (cropsathi_v1.onnx): Cotton, Rice, Tomato (27 classes)
 * 2. PlantVillage ONNX model (plantvillage_38.onnx): 14 crops (38 classes)
 * and CropSathi disease codes.
 *
 * Crops outside these 16 supported crops (wheat, sugarcane, mustard, etc.)
 * or predictions below the model confidence threshold fall back to Gemini vision.
 */

/** Plants the ML service can diagnose (app cropType values + aliases). */
export const SUPPORTED_CROPS = [
  'cotton', 'rice', 'tomato',
  'maize', 'grapes', 'potato', 'soybean',
  'apple', 'blueberry', 'cherry', 'orange', 'peach', 'pepper', 'raspberry', 'squash', 'strawberry',
];

/** Alias normalisation for cropType strings farmers may type. */
const CROP_ALIASES = {
  corn: 'maize',
  'corn (maize)': 'maize',
  grape: 'grapes',
  'bell pepper': 'pepper',
  paddy: 'rice',
  dhan: 'rice',
  kapas: 'cotton',
};

export function normalizeCrop(cropType) {
  if (!cropType) return '';
  return CROP_ALIASES[String(cropType).trim().toLowerCase()] || String(cropType).trim().toLowerCase();
}

export function isSupportedCrop(cropType) {
  return SUPPORTED_CROPS.includes(normalizeCrop(cropType));
}

/**
 * Model class name -> CropSathi disease code.
 * Includes both cropsathi_v1 format ('cotton__bacterial_blight')
 * and PlantVillage format ('Apple___Apple_scab').
 */
export const CLASS_TO_DISEASE = {
  // === cropsathi_v1 (Cotton, Rice, Tomato) ===
  'cotton__alternaria_leaf_spot': 'cotton_alternaria_leaf_spot',
  'cotton__bacterial_blight': 'cotton_bacterial_blight',
  'cotton__fusarium_wilt': 'cotton_fusarium_wilt',
  'cotton__healthy': 'healthy',
  'cotton__leaf_curl_virus': 'cotton_leaf_curl_virus',
  'cotton__leafhopper_damage': 'cotton_leafhopper_damage',

  'rice__bacterial_leaf_blight': 'rice_bacterial_leaf_blight',
  'rice__bacterial_leaf_streak': 'rice_bacterial_leaf_streak',
  'rice__bacterial_panicle_blight': 'rice_bacterial_panicle_blight',
  'rice__blast': 'rice_blast',
  'rice__brown_spot': 'rice_brown_spot',
  'rice__dead_heart': 'rice_dead_heart',
  'rice__downy_mildew': 'rice_downy_mildew',
  'rice__healthy': 'healthy',
  'rice__hispa': 'rice_hispa',
  'rice__test_images': 'healthy',
  'rice__tungro': 'rice_tungro',

  'tomato__bacterial_spot': 'tomato_bacterial_spot',
  'tomato__early_blight': 'tomato_early_blight',
  'tomato__healthy': 'healthy',
  'tomato__late_blight': 'tomato_late_blight',
  'tomato__leaf_mold': 'tomato_leaf_mold',
  'tomato__mosaic_virus': 'tomato_mosaic_virus',
  'tomato__septoria_leaf_spot': 'tomato_septoria_leaf_spot',
  'tomato__spider_mites': 'tomato_spider_mite',
  'tomato__target_spot': 'tomato_target_spot',
  'tomato__yellow_leaf_curl_virus': 'tomato_yellow_leaf_curl_virus',

  // === PlantVillage 38-class model ===
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

/** Severity bands derived from softmax confidence. */
export function severityFromConfidence(confidence) {
  if (confidence >= 0.95) return 'severe';
  if (confidence >= 0.85) return 'moderate';
  return 'mild';
}

/** Human-readable display text for both model formats. */
export function humanizeClassName(className) {
  return String(className || '')
    .replace(/\(including_sour\)/g, 'Cherry')
    .replace(/\(maize\)/g, '')
    .replace(/___/g, ' ')
    .replace(/__/g, ' ')
    .replace(/_/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build standard diagnosis result shape for saveDiagnosisResult and frontend.
 */
export function buildCnnResult(prediction, farm = {}) {
  const className = prediction.class_name || '';
  const confidence = Number(prediction.confidence) || 0;
  const topK = Array.isArray(prediction.top_k) ? prediction.top_k : [];
  const diseaseCode = CLASS_TO_DISEASE[className] || className.toLowerCase();
  const healthy = diseaseCode === 'healthy';
  const display = humanizeClassName(className);
  const modelVersion = prediction.model_version || 'plant-disease-cnn-38';

  let detectedCrop = farm.cropType || '';
  if (!detectedCrop) {
    if (className.includes('___')) {
      detectedCrop = String(className.split('___')[0] || '').toLowerCase();
    } else if (className.includes('__')) {
      detectedCrop = String(className.split('__')[0] || '').toLowerCase();
    }
  }

  const isTierA = className.includes('__') && !className.includes('___');
  const modelName = isTierA ? 'CropSathi ML (Tier A)' : 'PlantVillage CNN (38 classes)';

  return {
    image_quality_ok: true,
    crop_identified: detectedCrop || 'unknown',
    detected_issue: healthy ? 'healthy' : diseaseCode,
    confidence: Math.round(confidence * 1000) / 1000,
    severity: healthy ? 'none' : severityFromConfidence(confidence),
    symptoms_observed: healthy ? [] : [display],
    matches_risk_signal: confidence >= (prediction.confidence_threshold || 0.75),
    disease_description: display,
    treatment: { immediate_actions: [], chemical: '', biological: '', cultural: '', application_schedule: '', withholding_period: '' },
    prevention: [],
    notes: `Detected by ${modelName}. Top matches: ${
      topK.slice(0, 3).map((t) => `${humanizeClassName(t.class_name)} (${Math.round((t.confidence || 0) * 100)}%)`).join(', ')
    }.`,
    modelVersion,
    _modelSource: 'cnn',
  };
}