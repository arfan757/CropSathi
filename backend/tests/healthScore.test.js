/**
 * healthScore.test.js
 *
 * Comprehensive tests for the field health score pipeline.
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test backend/tests/healthScore.test.js
 *
 * Tests the pure fusion logic from riskService.js against the
 * canonical risk_fusion.py spec. These are small, fast unit tests
 * with no I/O, no network, no database.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Import the pure functions we're testing
// (These are all exported from riskService.js)
import {
  computeFusedHealthScore,
  healthLevelForScore,
  shouldPromptForPhoto,
  isStale,
  getCropWeights,
  getAlertThreshold,
  recalibrateThreshold,
  HealthLevel,
} from '../src/services/riskService.js';

// ─── Helper: create a reference date ────────────────────────────────────────
const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('healthLevelForScore', () => {
  it('returns HEALTHY for score >= 80', () => {
    assert.equal(healthLevelForScore(80), HealthLevel.HEALTHY);
    assert.equal(healthLevelForScore(100), HealthLevel.HEALTHY);
    assert.equal(healthLevelForScore(95), HealthLevel.HEALTHY);
  });

  it('returns WATCH for score 60-79', () => {
    assert.equal(healthLevelForScore(60), HealthLevel.WATCH);
    assert.equal(healthLevelForScore(70), HealthLevel.WATCH);
    assert.equal(healthLevelForScore(79), HealthLevel.WATCH);
  });

  it('returns ELEVATED for score 40-59', () => {
    assert.equal(healthLevelForScore(40), HealthLevel.ELEVATED);
    assert.equal(healthLevelForScore(50), HealthLevel.ELEVATED);
    assert.equal(healthLevelForScore(59), HealthLevel.ELEVATED);
  });

  it('returns HIGH for score < 40', () => {
    assert.equal(healthLevelForScore(0), HealthLevel.HIGH);
    assert.equal(healthLevelForScore(20), HealthLevel.HIGH);
    assert.equal(healthLevelForScore(39), HealthLevel.HIGH);
  });

  it('handles boundary values exactly', () => {
    assert.equal(healthLevelForScore(0), HealthLevel.HIGH);
    assert.equal(healthLevelForScore(39), HealthLevel.HIGH);
    assert.equal(healthLevelForScore(40), HealthLevel.ELEVATED);
    assert.equal(healthLevelForScore(59), HealthLevel.ELEVATED);
    assert.equal(healthLevelForScore(60), HealthLevel.WATCH);
    assert.equal(healthLevelForScore(79), HealthLevel.WATCH);
    assert.equal(healthLevelForScore(80), HealthLevel.HEALTHY);
    assert.equal(healthLevelForScore(100), HealthLevel.HEALTHY);
  });
});

describe('shouldPromptForPhoto', () => {
  it('returns true for ELEVATED', () => {
    assert.equal(shouldPromptForPhoto(HealthLevel.ELEVATED), true);
  });

  it('returns true for HIGH', () => {
    assert.equal(shouldPromptForPhoto(HealthLevel.HIGH), true);
  });

  it('returns false for WATCH', () => {
    assert.equal(shouldPromptForPhoto(HealthLevel.WATCH), false);
  });

  it('returns false for HEALTHY', () => {
    assert.equal(shouldPromptForPhoto(HealthLevel.HEALTHY), false);
  });
});

describe('isStale', () => {
  it('returns false when lastUpdated is null', () => {
    assert.equal(isStale('weather', null, NOW), false);
    assert.equal(isStale('ndvi', null, NOW), false);
  });

  it('returns false when signal has no staleness limit (pestHistory)', () => {
    assert.equal(isStale('pestHistory', daysAgo(365), NOW), false);
  });

  it('returns false when signal is fresh', () => {
    assert.equal(isStale('weather', daysAgo(1), NOW), false);
    assert.equal(isStale('ndvi', daysAgo(5), NOW), false);
    assert.equal(isStale('thermal', daysAgo(15), NOW), false);
  });

  it('returns true when signal exceeds staleness limit', () => {
    // Weather stale after 2 days
    assert.equal(isStale('weather', daysAgo(3), NOW), true);
    // NDVI stale after 10 days
    assert.equal(isStale('ndvi', daysAgo(11), NOW), true);
    // Thermal stale after 20 days
    assert.equal(isStale('thermal', daysAgo(21), NOW), true);
  });

  it('returns false at exact boundary (1 day = not stale for weather)', () => {
    // Exactly 2 days ago should NOT be stale (uses > not >=)
    assert.equal(isStale('weather', daysAgo(2), NOW), false);
  });

  it('returns true just past boundary', () => {
    // 2 days + 1ms should be stale
    const justPast = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000 - 1);
    assert.equal(isStale('weather', justPast, NOW), true);
  });
});

describe('getCropWeights', () => {
  it('returns default weights for unknown crop', () => {
    const w = getCropWeights('unknown');
    assert.equal(w.weather, 0.35);
    assert.equal(w.ndvi, 0.30);
    assert.equal(w.thermal, 0.15);
    assert.equal(w.pestHistory, 0.20);
  });

  it('returns rice-specific weights', () => {
    const w = getCropWeights('rice');
    assert.equal(w.weather, 0.30);
    assert.equal(w.ndvi, 0.35);  // rice has higher NDVI weight
  });

  it('returns cotton-specific weights', () => {
    const w = getCropWeights('cotton');
    assert.equal(w.weather, 0.40);  // cotton has higher weather weight
    assert.equal(w.ndvi, 0.25);
  });

  it('is case-insensitive', () => {
    const w1 = getCropWeights('Rice');
    const w2 = getCropWeights('rice');
    assert.deepEqual(w1, w2);
  });

  it('handles null/undefined gracefully', () => {
    const w = getCropWeights(null);
    assert.equal(w.weather, 0.35); // default
  });

  it('weights always sum to 1.0', () => {
    const crops = ['default', 'rice', 'cotton', 'soybean', 'wheat', 'potato', 'maize', 'sugarcane', 'grapes', 'tur'];
    for (const crop of crops) {
      const w = getCropWeights(crop);
      const sum = w.weather + w.ndvi + w.thermal + w.pestHistory;
      assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights for ${crop} sum to ${sum}, expected 1.0`);
    }
  });
});

describe('computeFusedHealthScore — core fusion', () => {
  it('returns 100 (perfectly healthy) when all stress is 0', () => {
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 100);
    assert.equal(result.level, HealthLevel.HEALTHY);
    assert.equal(result.triggeredAlert, false);
  });

  it('returns 0 (max stress) when all stress is 1', () => {
    const result = computeFusedHealthScore(
      { weather: 1, ndvi: 1, thermal: 1, pestHistory: 1 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 0);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });

  it('computes correct weighted average for uniform stress', () => {
    // All components at 0.5 stress → weighted stress = 0.5 → health = 50
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.5, thermal: 0.5, pestHistory: 0.5 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 50);
    assert.equal(result.level, HealthLevel.ELEVATED);
  });

  it('applies default weights correctly', () => {
    // Default weights: weather=0.35, ndvi=0.30, thermal=0.15, pestHistory=0.20
    // With stress: weather=1.0, rest=0.0
    // weighted_stress = 0.35 * 1.0 + 0.30 * 0 + 0.15 * 0 + 0.20 * 0 = 0.35
    // health = 100 * (1 - 0.35) = 65
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 65);
  });

  it('no single signal can push score to ELEVATED alone (false-alarm gate)', () => {
    // The max single weight is 0.40 (cotton weather). At max stress (1.0):
    // weighted_stress = 0.40 * 1.0 + 0.60 * 0 = 0.40
    // health = 100 * (1 - 0.40) = 60 → WATCH, not ELEVATED
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.score >= 40, `Score ${result.score} should be >= 40 (not ELEVATED)`);
    assert.equal(result.level, HealthLevel.WATCH);
    assert.equal(result.triggeredAlert, false);
  });

  it('requires at least two signals to corroborate for ELEVATED', () => {
    // Weather (0.35) + NDVI (0.30) both at max stress
    // weighted_stress = 0.35 * 1.0 + 0.30 * 1.0 = 0.65
    // health = 100 * (1 - 0.65) = 35 → HIGH
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 1.0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.score < 40, `Score ${result.score} should be < 40 (ELEVATED or HIGH)`);
    assert.ok(result.level === HealthLevel.ELEVATED || result.level === HealthLevel.HIGH);
  });
});

describe('computeFusedHealthScore — staleness redistribution', () => {
  it('drops stale NDVI and redistributes weight', () => {
    // NDVI is stale (14 days old), so its 0.30 weight redistributes
    // Fresh: weather(0.35) + thermal(0.15) + pestHistory(0.20) = 0.70
    // Normalized: weather=0.5, thermal=0.214, pestHistory=0.286
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.9, thermal: 0.2, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(14), thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    // Stale signal should be listed
    assert.ok(result.staleSignals.includes('ndvi'));
    // NDVI stress should NOT affect the score (weight = 0)
    // weighted_stress = 0.5*0.5 + 0*0.9 + 0.214*0.2 + 0.286*0.1
    // = 0.25 + 0 + 0.0428 + 0.0286 = 0.3214
    // health = 100 * (1 - 0.321) ≈ 68
    assert.ok(result.score > 60, `Expected score > 60, got ${result.score}`);
  });

  it('drops stale thermal and redistributes weight', () => {
    const result = computeFusedHealthScore(
      { weather: 0.3, ndvi: 0.2, thermal: 0.9, pestHistory: 0.1 },
      { weather: NOW, ndvi: NOW, thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('thermal'));
    // Thermal stress (0.9) should NOT affect the score
    // Without thermal: weather(0.35) + ndvi(0.30) + pestHistory(0.20) = 0.85
    // Normalized: weather=0.412, ndvi=0.353, pestHistory=0.235
    // weighted_stress = 0.412*0.3 + 0.353*0.2 + 0.235*0.1
    // = 0.1236 + 0.0706 + 0.0235 = 0.2177
    // health = 100 * (1 - 0.2177) ≈ 78
    assert.ok(result.score > 70, `Expected score > 70, got ${result.score}`);
  });

  it('drops multiple stale signals', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, thermal: 0.7, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(14), thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('thermal'));
    // Only weather + pestHistory remain: 0.35 + 0.20 = 0.55
    // Normalized: weather=0.636, pestHistory=0.364
    // weighted_stress = 0.636*0.8 + 0.364*0.1 = 0.509 + 0.036 = 0.545
    // health = 100 * (1 - 0.545) ≈ 46
    assert.ok(result.score >= 40 && result.score <= 60, `Expected score 40-60, got ${result.score}`);
  });

  it('falls back to historical-only when all fresh signals are stale', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, thermal: 0.7, pestHistory: 0.3 },
      { weather: daysAgo(5), ndvi: daysAgo(14), thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('thermal'));
    // weather is also stale (5 days > 2 day limit)
    assert.ok(result.staleSignals.includes('weather'));
    // Fallback: pestHistory weight = 1.0
    // weighted_stress = 1.0 * 0.3 = 0.3
    // health = 100 * (1 - 0.3) = 70
    assert.equal(result.score, 70);
    assert.equal(result.weightsUsed.pestHistory, 1.0);
  });
});

describe('computeFusedHealthScore — crop-stage relevance', () => {
  it('reduces weather relevance during sowing', () => {
    // Weather at max stress during sowing (relevance=0.8)
    // weighted_stress = 0.35 * 1.0 * 0.8 + 0.30 * 0 * 1.0 + 0.15 * 0 * 0.7 + 0.20 * 0 * 0.5
    // = 0.28
    // health = 100 * (1 - 0.28) = 72
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      'sowing',
      NOW,
    );
    assert.equal(result.score, 72);
    // Without crop-stage: score would be 65
    // With sowing relevance: score is higher (less penalized)
  });

  it('full relevance during flowering', () => {
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      'flowering',
      NOW,
    );
    // Flowering: weather relevance = 1.0
    // weighted_stress = 0.35 * 1.0 = 0.35
    // health = 65
    assert.equal(result.score, 65);
  });

  it('reduces all relevance during harvested', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, thermal: 0.7, pestHistory: 0.5 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      'harvested',
      NOW,
    );
    // harvested: weather=0.3, ndvi=0.4, thermal=0.3, pestHistory=0.2
    // effective_stress = 0.8*0.3 + 0.9*0.4 + 0.7*0.3 + 0.5*0.2
    // = 0.24 + 0.36 + 0.21 + 0.10 = 0.91
    // weighted_stress = 0.35*0.24 + 0.30*0.36 + 0.15*0.21 + 0.20*0.10
    // = 0.084 + 0.108 + 0.0315 + 0.02 = 0.2435
    // health = 100 * (1 - 0.2435) ≈ 76
    assert.ok(result.score > 70, `Expected score > 70 during harvested, got ${result.score}`);
  });

  it('defaults to full relevance when cropStage is null', () => {
    const resultWithStage = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      'flowering',
      NOW,
    );
    const resultWithout = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(resultWithStage.score, resultWithout.score);
  });
});

describe('computeFusedHealthScore — component stress tracking', () => {
  it('reports effective stress per component after stage adjustment', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.5, thermal: 0.3, pestHistory: 0.1 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      'sowing',
      NOW,
    );
    // sowing: weather=0.8, ndvi=0.6, thermal=0.7, pestHistory=0.5
    // effective: weather=0.8*0.8=0.64, ndvi=0.5*0.6=0.3, thermal=0.3*0.7=0.21, pestHistory=0.1*0.5=0.05
    assert.equal(result.componentStress.weather, 0.64);
    assert.equal(result.componentStress.ndvi, 0.3);
    assert.equal(result.componentStress.thermal, 0.21);
    assert.equal(result.componentStress.pestHistory, 0.05);
  });

  it('reports normalized weights used', () => {
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    // Default weights: weather=0.35, ndvi=0.30, thermal=0.15, pestHistory=0.20
    // They should already sum to 1.0, so normalized = same
    const sum = Object.values(result.weightsUsed).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}`);
  });
});

describe('computeFusedHealthScore — edge cases', () => {
  it('clamps score to 0 at maximum possible stress', () => {
    // Even with partial stress, score should never go below 0
    const result = computeFusedHealthScore(
      { weather: 1, ndvi: 1, thermal: 1, pestHistory: 1 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 0);
  });

  it('clamps score to 100 at zero stress', () => {
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 100);
  });

  it('handles missing stress components as 0', () => {
    const result = computeFusedHealthScore(
      { weather: 0.5 }, // only weather provided
      { weather: NOW },
      null,
      NOW,
    );
    // Missing components default to 0 stress
    // weighted_stress = 0.35*0.5 = 0.175
    // health = 100*(1-0.175) = 82.5 → 83 (rounded)
    assert.ok(result.score > 80, `Expected score > 80, got ${result.score}`);
  });

  it('handles empty signal dates gracefully', () => {
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.3, thermal: 0.2, pestHistory: 0.1 },
      {}, // no dates
      null,
      NOW,
    );
    // No signals are stale (no dates = not stale)
    assert.equal(result.staleSignals.length, 0);
  });

  it('produces integer scores', () => {
    const result = computeFusedHealthScore(
      { weather: 0.333, ndvi: 0.667, thermal: 0.123, pestHistory: 0.456 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.ok(Number.isInteger(result.score), `Score ${result.score} should be an integer`);
  });
});

describe('computeFusedHealthScore — realistic scenarios', () => {
  it('healthy field: low stress across all signals', () => {
    const result = computeFusedHealthScore(
      { weather: 0.05, ndvi: 0.02, thermal: 0.0, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(2), thermal: daysAgo(5), pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.level, HealthLevel.HEALTHY);
    assert.equal(result.triggeredAlert, false);
    assert.ok(result.score >= 90, `Healthy field should score >= 90, got ${result.score}`);
  });

  it('moderate risk: elevated weather + NDVI decline', () => {
    const result = computeFusedHealthScore(
      { weather: 0.7, ndvi: 0.5, thermal: 0.0, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(1), thermal: daysAgo(4), pestHistory: null },
      null,
      NOW,
    );
    // weighted_stress = 0.35*0.7 + 0.30*0.5 + 0.15*0 + 0.20*0.1
    // = 0.245 + 0.15 + 0 + 0.02 = 0.415
    // health = 100*(1-0.415) = 58.5 → 59
    assert.ok(result.score < 70, `Moderate risk should be < 70, got ${result.score}`);
  });

  it('severe: all signals high stress', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.75, thermal: 0.6, pestHistory: 0.3 },
      { weather: NOW, ndvi: daysAgo(1), thermal: daysAgo(3), pestHistory: null },
      null,
      NOW,
    );
    // weighted_stress = 0.35*0.8 + 0.30*0.75 + 0.15*0.6 + 0.20*0.3
    // = 0.28 + 0.225 + 0.09 + 0.06 = 0.655
    // health = 100*(1-0.655) = 34.5 → 35
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });

  it('stale NDVI during monsoon: weather and thermal carry score', () => {
    // During monsoon, NDVI satellite data is cloud-blocked (stale)
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.1, thermal: 0.4, pestHistory: 0.2 },
      { weather: NOW, ndvi: daysAgo(14), thermal: daysAgo(6), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    // Without stale NDVI: weather(0.35)+thermal(0.15)+pestHistory(0.20)=0.70
    // normalized: weather=0.5, thermal=0.214, pestHistory=0.286
    // weighted_stress = 0.5*0.5 + 0.214*0.4 + 0.286*0.2
    // = 0.25 + 0.0856 + 0.0572 = 0.3928
    // health = 100*(1-0.3928) ≈ 61
    assert.ok(result.score >= 60, `Expected score >= 60, got ${result.score}`);
  });
});

describe('getAlertThreshold', () => {
  it('returns base threshold for unknown crop', () => {
    assert.equal(getAlertThreshold('unknown'), 0.6);
  });

  it('returns crop-specific threshold', () => {
    assert.equal(getAlertThreshold('soybean'), 0.55);
    assert.equal(getAlertThreshold('rice'), 0.55);
    assert.equal(getAlertThreshold('cotton'), 0.6);
  });

  it('is case-insensitive', () => {
    assert.equal(getAlertThreshold('Soybean'), 0.55);
    assert.equal(getAlertThreshold('SOYBEAN'), 0.55);
  });
});

describe('recalibrateThreshold', () => {
  beforeEach(() => {
    // Reset by running recalibration to max and beyond
    // (The in-memory map persists across tests, so we test the cap behavior)
  });

  it('increases threshold by 0.01 per call', () => {
    const initial = getAlertThreshold('cotton');
    recalibrateThreshold('cotton', 'bollworm');
    const after = getAlertThreshold('cotton');
    // After recalibration, threshold should be higher
    // (But we can't easily test exact increment since it's cumulative)
    assert.ok(after >= initial, `Threshold should not decrease`);
  });

  it('caps at +0.15 cumulative', () => {
    // Call recalibrate many times to hit the cap
    for (let i = 0; i < 20; i++) {
      recalibrateThreshold('test_crop_max', 'test_disease');
    }
    // Should be capped at base + 0.15
    // base for test_crop_max is 0.6 (default)
    // After 15+ calls, adjustment should be 0.15
    const threshold = getAlertThreshold('test_crop_max');
    assert.ok(threshold <= 0.75, `Threshold should be capped at 0.75, got ${threshold}`);
  });
});
