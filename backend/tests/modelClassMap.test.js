import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  CLASS_TO_DISEASE,
  isSupportedCrop,
  severityFromConfidence,
  humanizeClassName,
  buildCnnResult,
} from '../src/config/modelClassMap.js';

describe('CLASS_TO_DISEASE', () => {
  it('maps all PlantVillage and Tier A classes', () => {
    assert.strictEqual(Object.keys(CLASS_TO_DISEASE).length, 65);
  });

  it('maps Potato___Late_blight to the existing advisory code', () => {
    assert.strictEqual(CLASS_TO_DISEASE['Potato___Late_blight'], 'potato_late_blight');
  });

  it('maps rice and cotton classes to advisory codes', () => {
    assert.strictEqual(CLASS_TO_DISEASE['rice__blast'], 'rice_blast');
    assert.strictEqual(CLASS_TO_DISEASE['cotton__bacterial_blight'], 'cotton_bacterial_blight');
  });

  it('maps every healthy class to healthy', () => {
    const healthy = Object.entries(CLASS_TO_DISEASE)
      .filter(([name]) => name.endsWith('healthy'))
      .map(([, code]) => code);
    assert.ok(healthy.length >= 12, `expected several healthy classes, got ${healthy.length}`);
    assert.ok(healthy.every((code) => code === 'healthy'));
  });
});

describe('isSupportedCrop', () => {
  it('accepts app crop codes the models cover', () => {
    assert.ok(isSupportedCrop('potato'));
    assert.ok(isSupportedCrop('maize'));
    assert.ok(isSupportedCrop('grapes'));
    assert.ok(isSupportedCrop('soybean'));
    assert.ok(isSupportedCrop('rice'));
    assert.ok(isSupportedCrop('cotton'));
    assert.ok(isSupportedCrop('tomato'));
  });

  it('accepts common aliases and case variants', () => {
    assert.ok(isSupportedCrop('corn'));
    assert.ok(isSupportedCrop('Corn (maize)'));
    assert.ok(isSupportedCrop('Tomato'));
    assert.ok(isSupportedCrop('grape'));
    assert.ok(isSupportedCrop('paddy'));
    assert.ok(isSupportedCrop('dhan'));
    assert.ok(isSupportedCrop('kapas'));
  });

  it('rejects crops outside the supported models', () => {
    assert.ok(!isSupportedCrop('wheat'));
    assert.ok(!isSupportedCrop('sugarcane'));
    assert.ok(!isSupportedCrop('tur'));
    assert.ok(!isSupportedCrop('mustard'));
    assert.ok(!isSupportedCrop('onion'));
  });
});

describe('severityFromConfidence', () => {
  it('bands confidence into mild/moderate/severe', () => {
    assert.strictEqual(severityFromConfidence(0.7), 'mild');
    assert.strictEqual(severityFromConfidence(0.85), 'moderate');
    assert.strictEqual(severityFromConfidence(0.95), 'severe');
    assert.strictEqual(severityFromConfidence(0.99), 'severe');
  });
});

describe('humanizeClassName', () => {
  it('turns class names into display text', () => {
    assert.strictEqual(humanizeClassName('Potato___Early_blight'), 'Potato Early Blight');
    assert.strictEqual(humanizeClassName('Tomato___healthy'), 'Tomato Healthy');
    assert.strictEqual(humanizeClassName('Corn_(maize)___Common_rust_'), 'Corn Common Rust');
    assert.strictEqual(humanizeClassName('cotton__bacterial_blight'), 'Cotton Bacterial Blight');
    assert.strictEqual(humanizeClassName('rice__blast'), 'Rice Blast');
  });
});

describe('buildCnnResult', () => {
  it('builds a Gemini-compatible result shape for a detected disease', () => {
    const r = buildCnnResult(
      {
        class_name: 'Potato___Early_blight',
        confidence: 0.93,
        top_k: [
          { class_name: 'Potato___Early_blight', confidence: 0.93 },
          { class_name: 'Potato___Late_blight', confidence: 0.05 },
        ],
      },
      { cropType: 'potato' }
    );
    assert.strictEqual(r.detected_issue, 'potato_early_blight');
    assert.strictEqual(r.confidence, 0.93);
    assert.strictEqual(r.severity, 'moderate');
    assert.strictEqual(r.matches_risk_signal, true);
    assert.strictEqual(r.crop_identified, 'potato');
    assert.strictEqual(r.image_quality_ok, true);
    assert.strictEqual(r.modelVersion, 'plant-disease-cnn-38');
    assert.ok(r.disease_description.includes('Potato Early Blight'));
    assert.ok(r.notes.includes('PlantVillage CNN'));
  });

  it('routes healthy classes to healthy', () => {
    const r = buildCnnResult({ class_name: 'Tomato___healthy', confidence: 0.9, top_k: [] }, {});
    assert.strictEqual(r.detected_issue, 'healthy');
    assert.strictEqual(r.severity, 'none');
  });

  it('uses the class crop when the farm crop is unknown', () => {
    const r = buildCnnResult({ class_name: 'Grape___Black_rot', confidence: 0.8, top_k: [] }, {});
    assert.strictEqual(r.crop_identified, 'Grape'.toLowerCase());
  });

  it('supports Tier A cotton and rice results', () => {
    const r = buildCnnResult({
      class_name: 'cotton__bacterial_blight',
      confidence: 0.94,
      model_version: 'cropsathi-v1-tierA',
      top_k: [{ class_name: 'cotton__bacterial_blight', confidence: 0.94 }]
    }, { cropType: 'cotton' });
    assert.strictEqual(r.detected_issue, 'cotton_bacterial_blight');
    assert.strictEqual(r.crop_identified, 'cotton');
    assert.strictEqual(r.modelVersion, 'cropsathi-v1-tierA');
    assert.ok(r.disease_description.includes('Cotton Bacterial Blight'));
  });
});