import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferCropStage,
  daysSinceSowing,
  isValidCropStage,
  CROP_STAGE_CALENDAR,
  CROP_STAGES,
} from '../src/services/cropStageService.js';

const DAY = 86400000;
const REF = new Date('2026-09-08T00:00:00Z');
const daysAgo = (n) => new Date(REF.getTime() - n * DAY).toISOString().slice(0, 10);

describe('inferCropStage', () => {
  it('returns sowing in the first days after sowing (cotton)', () => {
    assert.strictEqual(inferCropStage('Cotton', daysAgo(0), REF), 'sowing');
    assert.strictEqual(inferCropStage('Cotton', daysAgo(10), REF), 'sowing');
  });

  it('returns vegetative for mid-early cotton', () => {
    assert.strictEqual(inferCropStage('Cotton', daysAgo(30), REF), 'vegetative');
  });

  it('returns flowering / fruiting / maturity at cotton boundaries', () => {
    assert.strictEqual(inferCropStage('Cotton', daysAgo(51), REF), 'flowering');
    assert.strictEqual(inferCropStage('Cotton', daysAgo(100), REF), 'fruiting');
    assert.strictEqual(inferCropStage('Cotton', daysAgo(150), REF), 'maturity');
  });

  it('returns harvested for very old cotton', () => {
    assert.strictEqual(inferCropStage('Cotton', daysAgo(200), REF), 'harvested');
    assert.strictEqual(inferCropStage('Cotton', daysAgo(900), REF), 'harvested');
  });

  it('is case-insensitive on cropType', () => {
    assert.strictEqual(inferCropStage('cotton', daysAgo(30), REF), 'vegetative');
    assert.strictEqual(inferCropStage('COTTON', daysAgo(30), REF), 'vegetative');
  });

  it('falls back to generic calendar for unknown crops', () => {
    assert.strictEqual(inferCropStage('Dragonfruit', daysAgo(30), REF), 'vegetative');
    assert.strictEqual(inferCropStage(null, daysAgo(30), REF), 'vegetative');
  });

  it('returns sowing for a future sowing date', () => {
    const future = new Date(REF.getTime() + 5 * DAY).toISOString().slice(0, 10);
    assert.strictEqual(inferCropStage('Wheat', future, REF), 'sowing');
  });

  it('returns null for missing or invalid sowingDate', () => {
    assert.strictEqual(inferCropStage('Wheat', null, REF), null);
    assert.strictEqual(inferCropStage('Wheat', undefined, REF), null);
    assert.strictEqual(inferCropStage('Wheat', 'not-a-date', REF), null);
  });

  it('maps wheat through its shorter cycle', () => {
    assert.strictEqual(inferCropStage('Wheat', daysAgo(20), REF), 'vegetative');
    assert.strictEqual(inferCropStage('Wheat', daysAgo(50), REF), 'flowering');
    assert.strictEqual(inferCropStage('Wheat', daysAgo(80), REF), 'fruiting');
    assert.strictEqual(inferCropStage('Wheat', daysAgo(120), REF), 'maturity');
    assert.strictEqual(inferCropStage('Wheat', daysAgo(150), REF), 'harvested');
  });

  it('every calendar covers all six stages with contiguous ranges', () => {
    for (const [crop, cal] of Object.entries(CROP_STAGE_CALENDAR)) {
      for (const stage of CROP_STAGES) {
        assert.ok(Array.isArray(cal[stage]), `${crop} missing ${stage}`);
      }
      assert.strictEqual(cal.sowing[0], 0, `${crop} must start at day 0`);
      assert.strictEqual(cal.harvested[1], Infinity, `${crop} must end open-ended`);
    }
  });
});

describe('daysSinceSowing', () => {
  it('counts whole days', () => {
    assert.strictEqual(daysSinceSowing(daysAgo(42), REF), 42);
  });

  it('returns null for missing/invalid input', () => {
    assert.strictEqual(daysSinceSowing(null, REF), null);
    assert.strictEqual(daysSinceSowing('garbage', REF), null);
  });
});

describe('isValidCropStage', () => {
  it('accepts the six enum members only', () => {
    for (const s of CROP_STAGES) assert.strictEqual(isValidCropStage(s), true);
    assert.strictEqual(isValidCropStage(''), false);
    assert.strictEqual(isValidCropStage('germination'), false);
    assert.strictEqual(isValidCropStage(null), false);
  });
});
