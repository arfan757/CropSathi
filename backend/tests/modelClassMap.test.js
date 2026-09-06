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
  it('maps all 38 PlantVillage classes', () => {
    assert.strictEqual(Object.keys(CLASS_TO_DISEASE).length, 38);
  });

  it('maps Potato___Late_blight to the existing advisory code', () => {
    assert.strictEqual(CLASS_TO_DISEASE['Potato___Late_blight'], 'potato_late_blight');
  });

  it('maps every healthy class to healthy', () => {
    const healthy = Object.entries(CLASS_TO_DISEASE)
      .filter(([name]) => name.endsWith('___healthy'))
      .map(([, code]) => code);
    assert.ok(healthy.length >= 10, `expected several healthy classes, got ${healthy.length}`);
    assert.ok(healthy.every((code) => code === 'healthy'));
  });
});

describe('isSupportedCrop', () => {
  it('accepts app crop codes the model covers', () => {
    assert.ok(isSupportedCrop('potato'));
    assert.ok(isSupportedCrop('maize'));
    assert.ok(isSupportedCrop('grapes'));
    assert.ok(isSupportedCrop('soybean'));
  });

  it('accepts common aliases and case variants', () => {
    assert.ok(isSupportedCrop('corn'));
    assert.ok(isSupportedCrop('Corn (maize)'));
    assert.ok(isSupportedCrop('Tomato'));
    assert.ok(isSupportedCrop('grape'));
  });

  it('rejects crops outside the 38-class model', () => {
    assert.ok(!isSupportedCrop('rice'));
    assert.ok(!isSupportedCrop('cotton'));
    assert.ok(!isSupportedCrop('wheat'));
    assert.ok(!isSupportedCrop('sugarcane'));
    assert.ok(!isSupportedCrop('tur'));
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
});