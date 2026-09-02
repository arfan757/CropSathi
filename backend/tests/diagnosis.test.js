import { describe, it } from 'node:test';
import assert from 'node:assert';

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

describe('Gemini integration', () => {
  it('DIAGNOSIS_MODEL is gemini-3.6-flash', () => {
    const match = serviceSource.match(/DIAGNOSIS_MODEL\s*=\s*'([^']+)'/);
    assert.ok(match, 'DIAGNOSIS_MODEL should be defined');
    assert.strictEqual(match[1], 'gemini-3.6-flash');
  });

  it('diagnoseWithGemini reads files from disk, not memory', () => {
    // The service should use fs.readFileSync, not buffer access
    assert.ok(serviceSource.includes('readFile'), 'Should read from disk');
    assert.ok(serviceSource.includes('uploads'), 'Should look in uploads directory');
  });
});
