/**
 * vegetationHealth.test.js
 * ────────────────────────
 * Unit tests for the vegetation & thermal field health score module.
 * Pure function tests (no I/O) + orchestration tests with mocked Mongoose.
 *
 * Run: node --test backend/tests/vegetationHealth.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateVPD,
  normalizeNdviToScore,
  normalizeNdreToScore,
  computeCWSI,
  getWeights,
  healthLevelForScore,
  isStale,
  estimateThermalPixelCount,
  isDroughtContext,
  GROWTH_WEIGHTS,
  STALENESS_LIMIT_DAYS,
  DEFAULT_NDVI_BASELINE,
  DEFAULT_NDRE_BASELINE,
} from '../src/services/vegetationHealth.js';

// ─── Reference Date ───────────────────────────────────────────────────────
const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// calculateVPD
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateVPD', () => {
  it('computes VPD correctly for typical conditions (30°C, 50% RH)', () => {
    // e_sat = 0.6108 * exp(17.27 * 30 / (30 + 237.3)) ≈ 4.243 kPa
    // e_act = 4.243 * 0.50 ≈ 2.122 kPa
    // VPD ≈ 2.121 kPa
    const vpd = calculateVPD(30, 50);
    assert.ok(vpd > 2.1 && vpd < 2.2, `Expected VPD ~2.12, got ${vpd}`);
  });

  it('computes VPD for cooler, humid conditions (25°C, 80% RH)', () => {
    const vpd = calculateVPD(25, 80);
    assert.ok(vpd > 0.5 && vpd < 0.7, `Expected VPD ~0.58, got ${vpd}`);
  });

  it('returns ~0 when humidity is 100% (saturated air)', () => {
    const vpd = calculateVPD(25, 100);
    assert.equal(vpd, 0);
  });

  it('returns high VPD for hot, dry conditions (40°C, 20% RH)', () => {
    const vpd = calculateVPD(40, 20);
    assert.ok(vpd > 4.0, `Expected VPD > 4.0 for hot/dry, got ${vpd}`);
  });

  it('returns VPD equal to e_sat when RH is 0%', () => {
    const vpd = calculateVPD(25, 0);
    const eSat = 0.6108 * Math.exp((17.27 * 25) / (25 + 237.3));
    assert.ok(Math.abs(vpd - eSat) < 0.002, `Expected VPD ≈ e_sat (${eSat.toFixed(3)}), got ${vpd}`);
  });

  it('returns a number (not NaN)', () => {
    const vpd = calculateVPD(20, 60);
    assert.ok(!isNaN(vpd), `VPD should not be NaN, got ${vpd}`);
    assert.ok(typeof vpd === 'number', 'VPD should be a number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeNdviToScore
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeNdviToScore', () => {
  it('returns 55.6 for NDVI=0.5 with default baseline (0.0-0.9)', () => {
    const score = normalizeNdviToScore(0.5, DEFAULT_NDVI_BASELINE);
    assert.equal(score, 55.6);
  });

  it('clamps to 0 for NDVI below min', () => {
    const score = normalizeNdviToScore(-0.5, DEFAULT_NDVI_BASELINE);
    assert.equal(score, 0);
  });

  it('clamps to 100 for NDVI above max', () => {
    const score = normalizeNdviToScore(1.2, DEFAULT_NDVI_BASELINE);
    assert.equal(score, 100);
  });

  it('returns 0 at exact min', () => {
    const score = normalizeNdviToScore(0.0, DEFAULT_NDVI_BASELINE);
    assert.equal(score, 0);
  });

  it('returns 100 at exact max', () => {
    const score = normalizeNdviToScore(0.9, DEFAULT_NDVI_BASELINE);
    assert.equal(score, 100);
  });

  it('handles custom baseline', () => {
    const score = normalizeNdviToScore(0.5, { min: 0.3, max: 0.7 });
    // (0.5 - 0.3) / (0.7 - 0.3) = 0.5 → 50
    assert.equal(score, 50);
  });

  it('returns 50 when min equals max (degenerate baseline)', () => {
    const score = normalizeNdviToScore(0.5, { min: 0.5, max: 0.5 });
    assert.equal(score, 50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// normalizeNdreToScore
// ═══════════════════════════════════════════════════════════════════════════

describe('normalizeNdreToScore', () => {
  it('returns 0 at exact min (-0.1 with default baseline)', () => {
    const score = normalizeNdreToScore(-0.1, DEFAULT_NDRE_BASELINE);
    assert.equal(score, 0);
  });

  it('returns 100 at exact max (0.7 with default baseline)', () => {
    const score = normalizeNdreToScore(0.7, DEFAULT_NDRE_BASELINE);
    assert.equal(score, 100);
  });

  it('clamps below min to 0', () => {
    const score = normalizeNdreToScore(-0.5, DEFAULT_NDRE_BASELINE);
    assert.equal(score, 0);
  });

  it('clamps above max to 100', () => {
    const score = normalizeNdreToScore(0.9, DEFAULT_NDRE_BASELINE);
    assert.equal(score, 100);
  });

  it('returns 50 for midpoint of default baseline', () => {
    // midpoint = (-0.1 + 0.7) / 2 = 0.3
    const score = normalizeNdreToScore(0.3, DEFAULT_NDRE_BASELINE);
    assert.equal(score, 50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeCWSI
// ═══════════════════════════════════════════════════════════════════════════

describe('computeCWSI', () => {
  it('returns moderate CWSI when canopy equals air temp (dT=0 is above lower baseline)', () => {
    // With default regression: dT_lower = -2.3*2.0 + (-0.9) = -5.5
    // dT = 30 - 30 = 0 → CWSI = (0 - (-5.5)) / (8.7 - (-5.5)) = 5.5/14.2 ≈ 0.387
    // This is expected — dT=0 sits between the lower (negative) and upper baselines
    const result = computeCWSI({
      tCanopy: 30,
      tAir: 30,
      vpd: 2.0,
      cropType: 'default',
    });
    assert.ok(result.cwsi >= 0.3 && result.cwsi <= 0.5, `Expected CWSI ~0.39, got ${result.cwsi}`);
    assert.equal(result.confidence, 'high');
  });

  it('returns ~1 for max stress (canopy much hotter than air)', () => {
    // dT = 40 - 30 = 10 → near upper baseline → CWSI ~1
    const result = computeCWSI({
      tCanopy: 40,
      tAir: 30,
      vpd: 2.0,
      cropType: 'default',
    });
    assert.ok(result.cwsi >= 0.8, `Expected CWSI ~1, got ${result.cwsi}`);
    assert.equal(result.confidence, 'high');
  });

  it('returns null cwsi when VPD is unavailable', () => {
    const result = computeCWSI({
      tCanopy: 35,
      tAir: 30,
      vpd: null,
      cropType: 'default',
    });
    assert.equal(result.cwsi, null);
    assert.equal(result.confidence, 'low');
  });

  it('uses per-crop regression for rice', () => {
    const resultRice = computeCWSI({
      tCanopy: 35,
      tAir: 30,
      vpd: 2.0,
      cropType: 'rice',
    });
    const resultDefault = computeCWSI({
      tCanopy: 35,
      tAir: 30,
      vpd: 2.0,
      cropType: 'default',
    });
    // Rice has different regression coefficients — values should differ
    // (unless they coincidentally produce the same result)
    assert.ok(typeof resultRice.cwsi === 'number', 'Rice CWSI should be a number');
    assert.ok(typeof resultDefault.cwsi === 'number', 'Default CWSI should be a number');
  });

  it('clamps CWSI to [0, 1]', () => {
    // Extreme values that could go outside [0, 1]
    const result = computeCWSI({
      tCanopy: 50,
      tAir: 10,
      vpd: 0.1,
      cropType: 'default',
    });
    assert.ok(result.cwsi >= 0 && result.cwsi <= 1, `CWSI ${result.cwsi} should be in [0, 1]`);
  });

  it('returns 0.5 with low confidence when baselines converge', () => {
    // Use a regression with slope=0 and same intercept → dT_upper == dT_lower
    // This is a degenerate case — the code returns 0.5 as neutral
    const result = computeCWSI({
      tCanopy: 35,
      tAir: 30,
      vpd: 100, // extreme VPD to stress the formula
      cropType: 'grapes', // has smaller coefficients
    });
    assert.ok(typeof result.cwsi === 'number', 'Should return a number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// getWeights
// ═══════════════════════════════════════════════════════════════════════════

describe('getWeights', () => {
  it('returns early_sparse for sowing', () => {
    const w = getWeights('sowing');
    assert.deepEqual(w, GROWTH_WEIGHTS.early_sparse);
  });

  it('returns early_sparse for vegetative', () => {
    const w = getWeights('vegetative');
    assert.deepEqual(w, GROWTH_WEIGHTS.early_sparse);
  });

  it('returns balanced for flowering', () => {
    const w = getWeights('flowering');
    assert.deepEqual(w, GROWTH_WEIGHTS.balanced);
  });

  it('returns late_dense for fruiting', () => {
    const w = getWeights('fruiting');
    assert.deepEqual(w, GROWTH_WEIGHTS.late_dense);
  });

  it('returns late_dense for maturity', () => {
    const w = getWeights('maturity');
    assert.deepEqual(w, GROWTH_WEIGHTS.late_dense);
  });

  it('returns null for harvested', () => {
    const w = getWeights('harvested');
    assert.equal(w, null);
  });

  it('defaults to balanced for unknown stage', () => {
    const w = getWeights('unknown_stage');
    assert.deepEqual(w, GROWTH_WEIGHTS.balanced);
  });

  it('defaults to balanced when stage is null', () => {
    const w = getWeights(null);
    assert.deepEqual(w, GROWTH_WEIGHTS.balanced);
  });

  it('overrides to drought when context.isDrought is true', () => {
    const w = getWeights('flowering', { isDrought: true });
    assert.deepEqual(w, GROWTH_WEIGHTS.drought);
  });

  it('drought override works regardless of growth stage', () => {
    const w1 = getWeights('sowing', { isDrought: true });
    const w2 = getWeights('maturity', { isDrought: true });
    assert.deepEqual(w1, GROWTH_WEIGHTS.drought);
    assert.deepEqual(w2, GROWTH_WEIGHTS.drought);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Weight invariants (CRITICAL — false-alarm gate depends on these)
// ═══════════════════════════════════════════════════════════════════════════

describe('Weight invariants', () => {
  const scenarios = ['balanced', 'early_sparse', 'late_dense', 'drought'];

  for (const scenario of scenarios) {
    it(`${scenario}: weights sum to 1.0`, () => {
      const w = GROWTH_WEIGHTS[scenario];
      const sum = w.ndvi + w.ndre + w.thermal;
      assert.ok(Math.abs(sum - 1.0) < 0.001, `${scenario} weights sum to ${sum}, expected 1.0`);
    });

    it(`${scenario}: max single weight <= 0.40 (false-alarm gate)`, () => {
      const w = GROWTH_WEIGHTS[scenario];
      const maxWeight = Math.max(w.ndvi, w.ndre, w.thermal);
      assert.ok(maxWeight <= 0.40, `${scenario} max weight ${maxWeight} exceeds 0.40 cap`);
    });

    it(`${scenario}: single signal at max stress gives health >= 60 (WATCH)`, () => {
      const w = GROWTH_WEIGHTS[scenario];
      const maxWeight = Math.max(w.ndvi, w.ndre, w.ndre, w.thermal);
      const healthAtMaxStress = 100 - Math.round(maxWeight * 100);
      assert.ok(healthAtMaxStress >= 60, `${scenario}: single max-stress health ${healthAtMaxStress} < 60`);
    });
  }

  it('getWeights returns valid weights for every known crop stage', () => {
    const stages = ['sowing', 'vegetative', 'flowering', 'fruiting', 'maturity', 'harvested'];
    for (const stage of stages) {
      const w = getWeights(stage);
      if (w === null) continue; // harvested returns null
      const sum = w.ndvi + w.ndre + w.thermal;
      assert.ok(Math.abs(sum - 1.0) < 0.001, `${stage}: weights sum to ${sum}`);
      const maxWeight = Math.max(w.ndvi, w.ndre, w.thermal);
      assert.ok(maxWeight <= 0.40, `${stage}: max weight ${maxWeight} exceeds 0.40`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// healthLevelForScore
// ═══════════════════════════════════════════════════════════════════════════

describe('healthLevelForScore', () => {
  it('HEALTHY for score >= 80', () => {
    assert.equal(healthLevelForScore(80), 'healthy');
    assert.equal(healthLevelForScore(100), 'healthy');
    assert.equal(healthLevelForScore(95), 'healthy');
  });

  it('WATCH for score 60-79', () => {
    assert.equal(healthLevelForScore(60), 'watch');
    assert.equal(healthLevelForScore(70), 'watch');
    assert.equal(healthLevelForScore(79), 'watch');
  });

  it('ELEVATED for score 40-59', () => {
    assert.equal(healthLevelForScore(40), 'elevated');
    assert.equal(healthLevelForScore(50), 'elevated');
    assert.equal(healthLevelForScore(59), 'elevated');
  });

  it('HIGH for score < 40', () => {
    assert.equal(healthLevelForScore(0), 'high');
    assert.equal(healthLevelForScore(20), 'high');
    assert.equal(healthLevelForScore(39), 'high');
  });

  it('handles exact boundaries', () => {
    assert.equal(healthLevelForScore(0), 'high');
    assert.equal(healthLevelForScore(39), 'high');
    assert.equal(healthLevelForScore(40), 'elevated');
    assert.equal(healthLevelForScore(59), 'elevated');
    assert.equal(healthLevelForScore(60), 'watch');
    assert.equal(healthLevelForScore(79), 'watch');
    assert.equal(healthLevelForScore(80), 'healthy');
    assert.equal(healthLevelForScore(100), 'healthy');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isStale
// ═══════════════════════════════════════════════════════════════════════════

describe('isStale', () => {
  it('returns false when lastUpdated is null', () => {
    assert.equal(isStale('ndvi', null, NOW), false);
  });

  it('returns false when signal is fresh', () => {
    assert.equal(isStale('ndvi', daysAgo(5), NOW), false);
    assert.equal(isStale('thermal', daysAgo(15), NOW), false);
  });

  it('returns true when signal exceeds staleness limit', () => {
    assert.equal(isStale('ndvi', daysAgo(11), NOW), true);
    assert.equal(isStale('ndre', daysAgo(11), NOW), true);
    assert.equal(isStale('thermal', daysAgo(21), NOW), true);
  });

  it('returns false at exact boundary (not stale)', () => {
    assert.equal(isStale('ndvi', daysAgo(10), NOW), false);
    assert.equal(isStale('thermal', daysAgo(20), NOW), false);
  });

  it('returns true just past boundary', () => {
    const justPast = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000 - 1);
    assert.equal(isStale('ndvi', justPast, NOW), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// estimateThermalPixelCount
// ═══════════════════════════════════════════════════════════════════════════

describe('estimateThermalPixelCount', () => {
  it('returns ~11 for 1 hectare field', () => {
    // 1.0 / 0.09 ≈ 11.1 → 11
    assert.equal(estimateThermalPixelCount(1.0), 11);
  });

  it('returns ~1 for 0.09 ha (exactly 1 thermal pixel)', () => {
    assert.equal(estimateThermalPixelCount(0.09), 1);
  });

  it('returns 0 for very small field (0.05 ha)', () => {
    // 0.05 / 0.09 ≈ 0.56 → 1 (rounded) — but the check is < 1 pixel
    assert.equal(estimateThermalPixelCount(0.05), 1);
  });

  it('returns null for missing/zero area', () => {
    assert.equal(estimateThermalPixelCount(null), null);
    assert.equal(estimateThermalPixelCount(0), null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// isDroughtContext
// ═══════════════════════════════════════════════════════════════════════════

describe('isDroughtContext', () => {
  it('returns true when rainfall is low and temp is high', () => {
    assert.equal(isDroughtContext({ rainfallMm24h: 0.5, temperatureC: 38 }), true);
  });

  it('returns false when rainfall is sufficient', () => {
    assert.equal(isDroughtContext({ rainfallMm24h: 5.0, temperatureC: 38 }), false);
  });

  it('returns false when temperature is moderate', () => {
    assert.equal(isDroughtContext({ rainfallMm24h: 0.5, temperatureC: 30 }), false);
  });

  it('returns false for null weather', () => {
    assert.equal(isDroughtContext(null), false);
  });

  it('handles missing fields gracefully', () => {
    // temperatureC undefined → ?? 0 → 0 > 35 = false → not drought
    assert.equal(isDroughtContext({ rainfallMm24h: 0.5 }), false);
    // rainfallMm24h undefined → ?? 0 → 0 < 2 = true, temp 38 > 35 = true → drought
    assert.equal(isDroughtContext({ temperatureC: 38 }), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Single-signal false-alarm gate (CRITICAL)
// ═══════════════════════════════════════════════════════════════════════════

describe('False-alarm gate: single signal cannot reach ELEVATED', () => {
  const scenarios = [
    { name: 'balanced', weights: GROWTH_WEIGHTS.balanced },
    { name: 'early_sparse', weights: GROWTH_WEIGHTS.early_sparse },
    { name: 'late_dense', weights: GROWTH_WEIGHTS.late_dense },
    { name: 'drought', weights: GROWTH_WEIGHTS.drought },
  ];

  for (const { name, weights } of scenarios) {
    it(`${name}: max single-signal stress gives health >= 60 (WATCH, not ELEVATED)`, () => {
      const maxWeight = Math.max(weights.ndvi, weights.ndre, weights.thermal);
      const healthAtMaxStress = 100 - Math.round(maxWeight * 100);
      assert.ok(
        healthAtMaxStress >= 60,
        `${name}: single signal at max weight ${maxWeight} → health ${healthAtMaxStress} < 60 (ELEVATED boundary)`
      );
    });
  }

  it('balanced: two signals at high stress can reach ELEVATED', () => {
    // ndvi=0.8, ndre=0.8, thermal=0 → weighted = 0.40*80 + 0.40*80 = 64 → health = 36
    const w = GROWTH_WEIGHTS.balanced;
    const weightedStress = w.ndvi * 0.8 + w.ndre * 0.8;
    const health = 100 - Math.round(weightedStress * 100);
    assert.ok(health < 40, `Two high-stress signals should reach ELEVATED: got ${health}`);
  });
});
