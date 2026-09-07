import { describe, it } from 'node:test';
import assert from 'node:assert';
import { hasConcreteDosage, validateGeminiAdvisory, REMEDY_TYPE_ORDER, extractAdvisoryJson, normalizeDiseaseCode } from '../src/services/advisoryService.js';

const validPayload = {
  summary: 'Red rot detected.',
  pathogen_name: 'Glomerella tucumanensis (syn. Colletotrichum falcatum)',
  symptoms: 'Reddening of internal tissue with white patches, visible when cane is split lengthwise; sour smell; drying of leaves from top downward.',
  severity: 'moderate',
  remedies: [
    { type: 'cultural', action: 'Use disease-free setts', product_name: 'N/A', dosage: 'N/A', frequency: 'At planting', timing: 'Before sett selection', pre_harvest_interval_days: null, safety_notes: 'Rotate field' },
    { type: 'physical', action: 'Soil drenching at base', product_name: 'Carbendazim 50 WP', dosage: '1g per litre of water', frequency: 'Once', timing: 'Early stage', pre_harvest_interval_days: null, safety_notes: 'Remove clumps first' },
    { type: 'biological', action: 'Apply Trichoderma', product_name: 'Trichoderma harzianum', dosage: '2g per litre of water', frequency: 'Once', timing: 'At planting', pre_harvest_interval_days: null, safety_notes: '' },
    { type: 'chemical', action: 'Sett treatment', product_name: 'Carbendazim 50 WP', dosage: '0.5g per litre of water, with 2.5kg urea per 250 litres', frequency: 'Single dip', timing: 'Dip setts 18 minutes at 52°C', pre_harvest_interval_days: null, safety_notes: 'Control temperature' },
  ],
  follow_up_days: 7,
  escalate_to_cropsap: false,
  escalation_reason: null,
};

describe('hasConcreteDosage', () => {
  it('accepts real concentrations', () => {
    assert.strictEqual(hasConcreteDosage('1g per litre of water'), true);
    assert.strictEqual(hasConcreteDosage('0.5g per litre of water, with 2.5kg urea per 250 litres'), true);
    assert.strictEqual(hasConcreteDosage('3 ml/L'), true);
  });
  it('rejects generic guidance', () => {
    assert.strictEqual(hasConcreteDosage('apply appropriate fungicide'), false);
    assert.strictEqual(hasConcreteDosage('use recommended dose'), false);
    assert.strictEqual(hasConcreteDosage('N/A'), false);
    assert.strictEqual(hasConcreteDosage(''), false);
  });
});

describe('validateGeminiAdvisory', () => {
  it('accepts the TNAU-density payload and orders cultural→physical→biological→chemical', () => {
    const shuffled = { ...validPayload, remedies: [...validPayload.remedies].reverse() };
    const res = validateGeminiAdvisory(shuffled, 'moderate');
    assert.strictEqual(res.ok, true);
    assert.deepStrictEqual(res.content.remedies.map((r) => r.type), ['cultural', 'physical', 'biological', 'chemical']);
    assert.strictEqual(res.content.pathogenName, validPayload.pathogen_name);
  });
  it('rejects generic dosages on named products', () => {
    const bad = {
      ...validPayload,
      remedies: [{ type: 'chemical', action: 'Spray', product_name: 'Carbendazim 50 WP', dosage: 'apply appropriate fungicide', frequency: 'Once', timing: 'Now', safety_notes: '' }],
    };
    const res = validateGeminiAdvisory(bad, 'moderate');
    assert.strictEqual(res.ok, false);
    assert.match(res.reason, /generic dosage/);
  });
  it('drops chemical remedies when severity is mild', () => {
    const res = validateGeminiAdvisory(validPayload, 'mild');
    assert.strictEqual(res.ok, true);
    assert.ok(!res.content.remedies.some((r) => r.type === 'chemical'));
    assert.ok(res.content.remedies.some((r) => r.type === 'physical'));
  });
  it('requires pathogen_name and symptoms', () => {
    assert.strictEqual(validateGeminiAdvisory({ ...validPayload, pathogen_name: '' }, 'moderate').ok, false);
    assert.strictEqual(validateGeminiAdvisory({ ...validPayload, symptoms: '' }, 'moderate').ok, false);
  });
  it('remedy order map places physical between cultural and biological', () => {
    assert.ok(REMEDY_TYPE_ORDER.cultural < REMEDY_TYPE_ORDER.physical);
    assert.ok(REMEDY_TYPE_ORDER.physical < REMEDY_TYPE_ORDER.biological);
    assert.ok(REMEDY_TYPE_ORDER.biological < REMEDY_TYPE_ORDER.chemical);
  });
});

describe('extractAdvisoryJson', () => {
  it('parses raw JSON', () => {
    assert.deepStrictEqual(extractAdvisoryJson('{"remedies":[]}'), { remedies: [] });
  });
  it('strips markdown fences', () => {
    assert.deepStrictEqual(extractAdvisoryJson('```json\n{"remedies":[]}\n```'), { remedies: [] });
  });
  it('extracts JSON from surrounding prose', () => {
    assert.deepStrictEqual(extractAdvisoryJson('Here you go:\n{"a":1}\nHope this helps'), { a: 1 });
  });
  it('repairs truncated JSON', () => {
    const out = extractAdvisoryJson('{"remedies":[{"type":"cultural","action":"Do X"');
    assert.strictEqual(out.remedies[0].action, 'Do X');
  });
  it('throws on empty input', () => {
    assert.throws(() => extractAdvisoryJson(''), /Empty response/);
  });
});

describe('normalizeDiseaseCode', () => {
  const keys = ['sugarcane_red_rot', 'rice_blast', 'cotton_bollworm'];
  it('matches exact snake_case keys', () => {
    assert.strictEqual(normalizeDiseaseCode('rice_blast', 'rice', keys), 'rice_blast');
  });
  it('maps free text + crop to a known key', () => {
    assert.strictEqual(normalizeDiseaseCode('Red Rot', 'sugarcane', keys), 'sugarcane_red_rot');
    assert.strictEqual(normalizeDiseaseCode('Red Rot of Sugarcane', 'sugarcane', keys), 'sugarcane_red_rot');
  });
  it('suffix-matches unambiguous disease names', () => {
    assert.strictEqual(normalizeDiseaseCode('blast', 'rice', keys), 'rice_blast');
  });
  it('returns null for unknown/healthy', () => {
    assert.strictEqual(normalizeDiseaseCode('mystery blight xyz', 'wheat', keys), null);
    assert.strictEqual(normalizeDiseaseCode('healthy', 'wheat', keys), null);
    assert.strictEqual(normalizeDiseaseCode('', 'wheat', keys), null);
  });
});
