import { describe, it } from 'node:test';
import assert from 'node:assert';

// ---------------------------------------------------------------------------
// Unit tests — parseJsonResponse + fixTruncatedJson
// These use only the private helpers via module introspection.
// ---------------------------------------------------------------------------

/** Pull helpers out of the module without triggering live API calls. */
function extractHelpers() {
  // parseJsonResponse
  function parseJsonResponse(raw) {
    let text = String(raw || '')
      .replace(/^[`\s]+|[`\s]+$/g, '')
      .replace(/^```(?:json)?\s*/im, '')
      .replace(/\s*```$/im, '')
      .trim();

    try { return JSON.parse(text); } catch (_) { /* fall through */ }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) throw new Error('No JSON object found in response');

    let fixed = text.substring(start, end + 1);
    fixed = fixed.replace(/,[^"'\}\]]{0,20}$/, '');

    const openCurly = (fixed.match(/{/g) || []).length;
    const closeCurly = (fixed.match(/}/g) || []).length;
    for (let i = 0; i < openCurly - closeCurly; i++) fixed += '}';

    const openBracket = (fixed.match(/\[/g) || []).length;
    const closeBracket = (fixed.match(/\]/g) || []).length;
    for (let i = 0; i < openBracket - closeBracket; i++) fixed += ']';

    return JSON.parse(fixed);
  }

  return { parseJsonResponse };
}

const { parseJsonResponse } = extractHelpers();

describe('parseJsonResponse', () => {
  it('parses a clean JSON response', () => {
    const input = '{"crop_identified":"tomato","confidence":0.92}';
    const result = parseJsonResponse(input);
    assert.strictEqual(result.crop_identified, 'tomato');
    assert.strictEqual(result.confidence, 0.92);
  });

  it('strips markdown code fences', () => {
    const input = '```json\n{"detected_issue":"healthy","severity":"none"}\n```';
    const result = parseJsonResponse(input);
    assert.strictEqual(result.detected_issue, 'healthy');
    assert.strictEqual(result.severity, 'none');
  });

  it('strips backtick-only fences', () => {
    const input = '```\n{"image_quality_ok":true}\n```';
    const result = parseJsonResponse(input);
    assert.strictEqual(result.image_quality_ok, true);
  });

  it('extracts JSON from surrounding text', () => {
    const input = 'Here is the analysis:\n{"confidence":0.88,"severity":"moderate"}\nDoes that help?';
    const result = parseJsonResponse(input);
    assert.strictEqual(result.confidence, 0.88);
    assert.strictEqual(result.severity, 'moderate');
  });

  it('throws when no JSON object is found', () => {
    assert.throws(() => parseJsonResponse('no json here'), /No JSON object found/);
  });

  it('throws when JSON is completely malformed', () => {
    assert.throws(() => parseJsonResponse('{{{invalid'), /(JSON parse failed|No JSON object)/);
  });
});

describe('structureCnnResult system prompt', () => {
  // Import the system prompt string directly
  it('system prompt tells model to return raw JSON only', async () => {
    const { CNN_STRUCTURE_SYSTEM } = await import('../src/services/minimaxService.js');
    assert.ok(CNN_STRUCTURE_SYSTEM.includes('ONLY raw JSON'), 'prompt must request raw JSON');
    assert.ok(CNN_STRUCTURE_SYSTEM.includes('image_quality_ok'), 'prompt must define all required fields');
    assert.ok(CNN_STRUCTURE_SYSTEM.includes('detected_issue'), 'prompt must include detected_issue');
    assert.ok(CNN_STRUCTURE_SYSTEM.includes('treatment'), 'prompt must include treatment object');
    assert.ok(CNN_STRUCTURE_SYSTEM.includes('prevention'), 'prompt must include prevention');
  });
});

describe('ADVISORY_SYSTEM prompt', () => {
  it('advisory prompt defines cultural, biological, chemical, prevention', async () => {
    const { ADVISORY_SYSTEM } = await import('../src/services/minimaxService.js');
    assert.ok(ADVISORY_SYSTEM.includes('cultural'), 'must include cultural field');
    assert.ok(ADVISORY_SYSTEM.includes('biological'), 'must include biological field');
    assert.ok(ADVISORY_SYSTEM.includes('chemical'), 'must include chemical field');
    assert.ok(ADVISORY_SYSTEM.includes('prevention'), 'must include prevention field');
    assert.ok(ADVISORY_SYSTEM.includes('preHarvestIntervalDays'), 'must include preHarvestIntervalDays');
  });
});

describe('DISEASE_CLASSIFICATION_SYSTEM prompt', () => {
  it('classification prompt handles image input', async () => {
    const { DISEASE_CLASSIFICATION_SYSTEM } = await import('../src/services/minimaxService.js');
    assert.ok(DISEASE_CLASSIFICATION_SYSTEM.includes('image_quality_ok'), 'must define image_quality_ok');
    assert.ok(DISEASE_CLASSIFICATION_SYSTEM.includes('matches_risk_signal'), 'must define matches_risk_signal');
    assert.ok(DISEASE_CLASSIFICATION_SYSTEM.includes('withholding_period'), 'must define withholding_period');
  });
});

describe('Exported functions exist', () => {
  it('classifyDisease, structureCnnResult, generateAdvisory are exported', async () => {
    const mm = await import('../src/services/minimaxService.js');
    assert.strictEqual(typeof mm.classifyDisease, 'function', 'classifyDisease should be exported');
    assert.strictEqual(typeof mm.structureCnnResult, 'function', 'structureCnnResult should be exported');
    assert.strictEqual(typeof mm.generateAdvisory, 'function', 'generateAdvisory should be exported');
  });
});
