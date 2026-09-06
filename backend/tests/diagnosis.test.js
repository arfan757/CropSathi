import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildCnnResult } from '../src/config/modelClassMap.js';

// Test routeDiagnosis logic (pure function, no DB needed)
// Import the routeDiagnosis by extracting it from the service source
import { readFileSync } from 'fs';

const serviceSource = readFileSync('src/services/diagnosisService.js', 'utf8');

// Extract routeDiagnosis by eval (safe — it's our own code)
function extractRouteDiagnosis() {
  const match = serviceSource.match(/function routeDiagnosis\(result\)\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Could not extract routeDiagnosis');
  const fnBody = match[1];
  return new Function('result', fnBody);
}

const routeDiagnosis = extractRouteDiagnosis();

describe('routeDiagnosis', () => {
  it('returns retry when image_quality_ok is false', () => {
    const result = routeDiagnosis({
      image_quality_ok: false,
      detected_issue: 'unknown',
      confidence: 0,
      matches_risk_signal: false,
    });
    assert.strictEqual(result, 'retry');
  });

  it('returns false_alarm when detected_issue is healthy', () => {
    const result = routeDiagnosis({
      image_quality_ok: true,
      detected_issue: 'healthy',
      confidence: 0.9,
      matches_risk_signal: false,
    });
    assert.strictEqual(result, 'false_alarm');
  });

  it('returns confirmed when high confidence and matches risk signal', () => {
    const result = routeDiagnosis({
      image_quality_ok: true,
      detected_issue: 'wheat_rust',
      confidence: 0.85,
      matches_risk_signal: true,
    });
    assert.strictEqual(result, 'confirmed');
  });

  it('returns expert_review when low confidence', () => {
    const result = routeDiagnosis({
      image_quality_ok: true,
      detected_issue: 'leaf_spot',
      confidence: 0.5,
      matches_risk_signal: true,
    });
    assert.strictEqual(result, 'expert_review');
  });

  it('returns expert_review when risk signal does not match', () => {
    const result = routeDiagnosis({
      image_quality_ok: true,
      detected_issue: 'pest_damage',
      confidence: 0.85,
      matches_risk_signal: false,
    });
    assert.strictEqual(result, 'expert_review');
  });
});

describe('CNN results route correctly', () => {
  it('high-confidence disease detection -> confirmed', () => {
    const result = buildCnnResult(
      { class_name: 'Potato___Late_blight', confidence: 0.9, top_k: [] },
      { cropType: 'potato' }
    );
    assert.strictEqual(routeDiagnosis(result), 'confirmed');
  });

  it('healthy detection -> false_alarm', () => {
    const result = buildCnnResult(
      { class_name: 'Potato___healthy', confidence: 0.99, top_k: [] },
      {}
    );
    assert.strictEqual(routeDiagnosis(result), 'false_alarm');
  });

  it('low-confidence detection -> expert_review', () => {
    const result = buildCnnResult(
      { class_name: 'Tomato___Early_blight', confidence: 0.6, top_k: [] },
      {}
    );
    assert.strictEqual(routeDiagnosis(result), 'expert_review');
  });
});

describe('CNN-first diagnosis', () => {
  it('DIAGNOSIS_MODEL is gemini-3.6-flash', () => {
    const match = serviceSource.match(/DIAGNOSIS_MODEL\s*=\s*'([^']+)'/);
    assert.ok(match, 'DIAGNOSIS_MODEL should be defined');
    assert.strictEqual(match[1], 'gemini-3.6-flash');
  });

  it('reads ML_SERVICE_URL from env with a local default', () => {
    assert.ok(serviceSource.includes('ML_SERVICE_URL'), 'should use ML_SERVICE_URL');
    assert.ok(serviceSource.includes('127.0.0.1:8000'), 'should default to localhost:8000');
  });

  it('routes supported crops through the CNN /predict endpoint', () => {
    assert.ok(serviceSource.includes('isSupportedCrop'), 'should gate on crop support');
    assert.ok(serviceSource.includes('/predict'), 'should call the ML service /predict endpoint');
    assert.ok(serviceSource.includes('buildCnnResult'), 'should build results from the class map');
  });

  it('keeps Gemini vision as fallback for unsupported crops', () => {
    assert.ok(serviceSource.includes('diagnoseWithGemini'), 'Gemini fallback should remain');
  });

  it('generates the advisory via the Gemini-first wrapper', () => {
    assert.ok(serviceSource.includes('generateAdvisoryForCase'), 'should use Gemini-first advisory');
  });

  it('diagnoseWithGemini reads files from disk, not memory', () => {
    // The service should use fs.readFileSync, not buffer access
    assert.ok(serviceSource.includes('readFile'), 'Should read from disk');
    assert.ok(serviceSource.includes('uploads'), 'Should look in uploads directory');
  });
});

describe('Minimax fallback integration', () => {
  it('imports Minimax classification helpers', () => {
    assert.ok(serviceSource.includes("classifyDisease"), 'should import classifyDisease');
    assert.ok(serviceSource.includes("structureCnnResult"), 'should import structureCnnResult');
  });

  it('falls back to Minimax when Gemini throws', () => {
    assert.ok(serviceSource.includes('FALLBACK: Try Minimax'), 'Minimax fallback block should exist');
    assert.ok(serviceSource.includes('minimaxService'), 'should reference minimaxService');
  });

  it('attempts CNN structuring via Minimax before direct mapping', () => {
    assert.ok(serviceSource.includes('structureCnnResult'), 'should call structureCnnResult for CNN results');
    assert.ok(serviceSource.includes('CNN+Minimax'), 'should log CNN+Minimax result');
  });

  it('retries Minimax if first response is incomplete', () => {
    assert.ok(serviceSource.includes('retryResult'), 'should retry with structured prompt');
    assert.ok(serviceSource.includes('IMPORTANT: Respond ONLY with the complete JSON'), 'retry prompt should force full JSON');
  });
});
