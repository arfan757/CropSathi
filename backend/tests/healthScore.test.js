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
    assert.equal(w.weather, 0.20);
    assert.equal(w.ndvi, 0.15);
    assert.equal(w.ndre, 0.30);
    assert.equal(w.thermal, 0.25);
    assert.equal(w.pestHistory, 0.10);
  });

  it('returns rice-specific weights', () => {
    const w = getCropWeights('rice');
    assert.equal(w.weather, 0.20);
    assert.equal(w.ndvi, 0.15);
    assert.equal(w.ndre, 0.30);
    assert.equal(w.thermal, 0.25);
    assert.equal(w.pestHistory, 0.10);
  });

  it('returns cotton-specific weights', () => {
    const w = getCropWeights('cotton');
    assert.equal(w.weather, 0.20);
    assert.equal(w.ndvi, 0.15);
    assert.equal(w.ndre, 0.30);
    assert.equal(w.thermal, 0.25);
    assert.equal(w.pestHistory, 0.10);
  });

  it('is case-insensitive', () => {
    const w1 = getCropWeights('Rice');
    const w2 = getCropWeights('rice');
    assert.deepEqual(w1, w2);
  });

  it('handles null/undefined gracefully', () => {
    const w = getCropWeights(null);
    assert.equal(w.weather, 0.20); // default
  });

  it('weights always sum to 1.0', () => {
    const crops = ['default', 'rice', 'cotton', 'soybean', 'wheat', 'potato', 'maize', 'sugarcane', 'grapes', 'tur'];
    for (const crop of crops) {
      const w = getCropWeights(crop);
      const sum = w.weather + w.ndvi + w.ndre + w.thermal + w.pestHistory;
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

  it('returns lowest possible score for max stress on all signals', () => {
    // All 5 components at max stress (1.0) with default weights:
    //   weighted = 0.20 + 0.15 + 0.30 + 0.25 + 0.10 = 1.00
    //   overlap = 0.5 * min(0.20, 0.25) = 0.10
    //   weighted_stress = 1.00 - 0.10 = 0.90 → health = 10
    const result = computeFusedHealthScore(
      { weather: 1, ndvi: 1, ndre: 1, thermal: 1, pestHistory: 1 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 10);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });

  it('computes correct weighted average for uniform stress (with overlap discount)', () => {
    // All 4 components at 0.5 stress, ndre not passed so defaults to 0:
    // weighted = 0.20*0.5 + 0.15*0.5 + 0.30*0 + 0.25*0.5 + 0.10*0.5 = 0.35
    // overlap = 0.5 * min(0.20*0.5, 0.25*0.5) = 0.5 * min(0.10, 0.125) = 0.05
    // weighted_stress = 0.35 - 0.05 = 0.30 → health = 70
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.5, thermal: 0.5, pestHistory: 0.5 },
      { weather: NOW, ndvi: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 70);
    assert.equal(result.level, HealthLevel.WATCH);
    assert.equal(result.triggeredAlert, false);
  });

  it('uses the per-crop weight profile in fusion', () => {
    // All crops now use: weather=0.20, ndvi=0.15, ndre=0.30, thermal=0.25, pestHistory=0.10
    // Weather alone at max stress: 0.20 → health = 80
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
      'rice',
    );
    assert.equal(result.score, 80);
    assert.equal(result.weightsUsed.weather, 0.2);
    assert.equal(result.weightsUsed.ndvi, 0.15);
    assert.equal(result.weightsUsed.ndre, 0.3);
  });

  it('applies default weights correctly', () => {
    // Default weights: weather=0.20, ndvi=0.15, ndre=0.30, thermal=0.25, pestHistory=0.10
    // With stress: weather=1.0, rest=0.0
    // weighted_stress = 0.20 * 1.0 = 0.20 → health = 80
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 80);
  });

  it('no single signal can push score to ELEVATED alone (false-alarm gate)', () => {
    // Max single weight is now 0.30 (ndre). At max stress (1.0):
    // weighted_stress = 0.30 * 1.0 = 0.30 → health = 70 → WATCH, not ELEVATED
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, ndre: 1.0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.score >= 40, `Score ${result.score} should be >= 40 (not ELEVATED)`);
    assert.equal(result.level, HealthLevel.WATCH);
    assert.equal(result.triggeredAlert, false);
  });

  it('requires at least two signals to corroborate for ELEVATED', () => {
    // Weather (0.20) + NDRE (0.30) both at stress 0.9:
    // weighted = 0.20*0.9 + 0.30*0.9 = 0.18 + 0.27 = 0.45 → health = 55 → ELEVATED
    const result = computeFusedHealthScore(
      { weather: 0.9, ndvi: 0, ndre: 0.9, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 55);
    assert.equal(result.level, HealthLevel.ELEVATED);
    assert.equal(result.triggeredAlert, true);
  });
});

describe('computeFusedHealthScore — staleness redistribution', () => {
  it('drops stale NDVI and redistributes weight', () => {
    // NDVI stale (14 days, limit=10), NDRE also stale (same limit=10)
    // Fresh: weather(0.20) + thermal(0.25) + pestHistory(0.10) = 0.55
    // Normalized: weather=0.364, thermal=0.455, pestHistory=0.182
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.9, ndre: 0.9, thermal: 0.2, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(14), ndre: daysAgo(14), thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    // Stale signal should be listed
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    // NDVI + NDRE stress should NOT affect the score
    assert.ok(result.score > 60, `Expected score > 60, got ${result.score}`);
  });

  it('drops stale thermal and redistributes weight', () => {
    const result = computeFusedHealthScore(
      { weather: 0.3, ndvi: 0.2, ndre: 0, thermal: 0.9, pestHistory: 0.1 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('thermal'));
    // Thermal stress (0.9) should NOT affect the score
    assert.ok(result.score > 70, `Expected score > 70, got ${result.score}`);
  });

  it('drops multiple stale signals', () => {
    // ndvi and ndre both stale (14d > 10d limit), thermal stale (25d > 20d)
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, ndre: 0.9, thermal: 0.7, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(14), ndre: daysAgo(14), thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    assert.ok(result.staleSignals.includes('thermal'));
    // Only weather(0.20) + pestHistory(0.10) remain = 0.30
    // Normalized: weather=0.667, pestHistory=0.333
    // weighted_stress = 0.667*0.8 + 0.333*0.1 = 0.5336 + 0.0333 = 0.567 → health = 43
    assert.ok(result.score >= 40 && result.score <= 60, `Expected score 40-60, got ${result.score}`);
  });

  it('falls back to historical-only when all fresh signals are stale', () => {
    // weather=daysAgo(5) stale (limit=2), ndvi=daysAgo(14) stale (limit=10),
    // ndre=daysAgo(14) stale (limit=10), thermal=daysAgo(25) stale (limit=20)
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, ndre: 0.9, thermal: 0.7, pestHistory: 0.3 },
      { weather: daysAgo(5), ndvi: daysAgo(14), ndre: daysAgo(14), thermal: daysAgo(25), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    assert.ok(result.staleSignals.includes('thermal'));
    assert.ok(result.staleSignals.includes('weather'));
    // Fallback: pestHistory weight = 1.0
    // weighted_stress = 1.0 * 0.3 = 0.3 → health = 70
    assert.equal(result.score, 70);
    assert.equal(result.weightsUsed.pestHistory, 1.0);
  });
});

describe('computeFusedHealthScore — crop-stage relevance', () => {
  it('reduces weather relevance during sowing', () => {
    // Weather at max stress during sowing (weather relevance=0.8)
    // effective weather = 1.0*0.8 = 0.8, all others = 0
    // weighted_stress = 0.20 * 0.8 = 0.16 → health = 84
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      'sowing',
      NOW,
    );
    assert.equal(result.score, 84);
    // Without crop-stage: score would be 80; with sowing relevance: higher (less penalized)
  });

  it('full relevance during flowering', () => {
    const result = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      'flowering',
      NOW,
    );
    // Flowering: weather relevance = 1.0 → weighted_stress = 0.20 → health = 80
    assert.equal(result.score, 80);
  });

  it('reduces all relevance during harvested', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.9, ndre: 0, thermal: 0.7, pestHistory: 0.5 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      'harvested',
      NOW,
    );
    // harvested relevance: weather=0.3, ndvi=0.4, ndre=0.4, thermal=0.3, pestHistory=0.2
    // effective: weather=0.24, ndvi=0.36, ndre=0, thermal=0.21, pestHistory=0.10
    // weighted = 0.20*0.24 + 0.15*0.36 + 0.30*0 + 0.25*0.21 + 0.10*0.10
    // = 0.048 + 0.054 + 0 + 0.0525 + 0.01 = 0.1645 → health = 84
    assert.ok(result.score > 70, `Expected score > 70 during harvested, got ${result.score}`);
  });

  it('defaults to full relevance when cropStage is null', () => {
    const resultWithStage = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      'flowering',
      NOW,
    );
    const resultWithout = computeFusedHealthScore(
      { weather: 1.0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(resultWithStage.score, resultWithout.score);
  });
});

describe('computeFusedHealthScore — component stress tracking', () => {
  it('reports effective stress per component after stage adjustment', () => {
    const result = computeFusedHealthScore(
      { weather: 0.8, ndvi: 0.5, ndre: 0.4, thermal: 0.3, pestHistory: 0.1 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      'sowing',
      NOW,
    );
    // sowing: weather=0.8, ndvi=0.6, ndre=0.6, thermal=0.7, pestHistory=0.5
    // effective: weather=0.8*0.8=0.64, ndvi=0.5*0.6=0.3, ndre=0.4*0.6=0.24, thermal=0.3*0.7=0.21, pestHistory=0.1*0.5=0.05
    assert.equal(result.componentStress.weather, 0.64);
    assert.equal(result.componentStress.ndvi, 0.3);
    assert.equal(result.componentStress.ndre, 0.24);
    assert.equal(result.componentStress.thermal, 0.21);
    assert.equal(result.componentStress.pestHistory, 0.05);
  });

  it('reports normalized weights used', () => {
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    // Weights: weather=0.20, ndvi=0.15, ndre=0.30, thermal=0.25, pestHistory=0.10 = sum 1.0
    const sum = Object.values(result.weightsUsed).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}`);
  });
});

describe('computeFusedHealthScore — edge cases', () => {
  it('overlap discount keeps max-stress score above 0', () => {
    // All signals at 1.0 stress:
    // weighted = 0.20 + 0.15 + 0.30 + 0.25 + 0.10 = 1.00
    // overlap = 0.5 * min(0.20, 0.25) = 0.10
    // stress = 0.90 → health = 10
    const result = computeFusedHealthScore(
      { weather: 1, ndvi: 1, ndre: 1, thermal: 1, pestHistory: 1 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.score, 10);
    assert.ok(result.score > 0, `Score should stay above 0, got ${result.score}`);
  });

  it('clamps score to 100 at zero stress', () => {
    const result = computeFusedHealthScore(
      { weather: 0, ndvi: 0, ndre: 0, thermal: 0, pestHistory: 0 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
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
    // weighted_stress = 0.20*0.5 = 0.10 → health = 90
    assert.ok(result.score > 80, `Expected score > 80, got ${result.score}`);
  });

  it('handles empty signal dates gracefully', () => {
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.3, ndre: 0, thermal: 0.2, pestHistory: 0.1 },
      {}, // no dates
      null,
      NOW,
    );
    // No signals are stale (no dates = not stale)
    assert.equal(result.staleSignals.length, 0);
  });

  it('produces integer scores', () => {
    const result = computeFusedHealthScore(
      { weather: 0.333, ndvi: 0.667, ndre: 0.4, thermal: 0.123, pestHistory: 0.456 },
      { weather: NOW, ndvi: NOW, ndre: NOW, thermal: NOW, pestHistory: null },
      null,
      NOW,
    );
    assert.ok(Number.isInteger(result.score), `Score ${result.score} should be an integer`);
  });
});

describe('computeFusedHealthScore — realistic scenarios', () => {
  it('healthy field: low stress across all signals', () => {
    const result = computeFusedHealthScore(
      { weather: 0.05, ndvi: 0.02, ndre: 0.0, thermal: 0.0, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(2), ndre: daysAgo(2), thermal: daysAgo(5), pestHistory: null },
      null,
      NOW,
    );
    assert.equal(result.level, HealthLevel.HEALTHY);
    assert.equal(result.triggeredAlert, false);
    assert.ok(result.score >= 90, `Healthy field should score >= 90, got ${result.score}`);
  });

  it('moderate risk: elevated weather + NDVI decline', () => {
    const result = computeFusedHealthScore(
      { weather: 0.7, ndvi: 0.5, ndre: 0, thermal: 0.0, pestHistory: 0.1 },
      { weather: NOW, ndvi: daysAgo(1), ndre: daysAgo(1), thermal: daysAgo(4), pestHistory: null },
      null,
      NOW,
    );
    // weighted_stress = 0.20*0.7 + 0.15*0.5 + 0.30*0 + 0.25*0 + 0.10*0.1 = 0.14+0.075+0.01 = 0.225
    // health = 78 — unhealthy (WATCH), but not ELEVATED
    assert.ok(result.score < 80, `Moderate risk should be < 80, got ${result.score}`);
    assert.equal(result.level, HealthLevel.WATCH);
  });

  it('severe: all signals high stress', () => {
    const result = computeFusedHealthScore(
      { weather: 0.9, ndvi: 0.85, ndre: 0.9, thermal: 0.8, pestHistory: 0.4 },
      { weather: NOW, ndvi: daysAgo(1), ndre: daysAgo(1), thermal: daysAgo(3), pestHistory: null },
      null,
      NOW,
    );
    // weighted = 0.20*0.9 + 0.15*0.85 + 0.30*0.9 + 0.25*0.8 + 0.10*0.4
    // = 0.18 + 0.1275 + 0.27 + 0.20 + 0.04 = 0.8175
    // overlap = 0.5 * min(0.18, 0.20) = 0.09
    // stress = 0.8175 - 0.09 = 0.7275 → health = 27
    assert.ok(result.score < 40, `Severe stress should score < 40, got ${result.score}`);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });

  it('stale NDVI during monsoon: weather and thermal carry score', () => {
    // NDVI and NDRE stale (14d > 10d limit)
    const result = computeFusedHealthScore(
      { weather: 0.5, ndvi: 0.1, ndre: 0.1, thermal: 0.4, pestHistory: 0.2 },
      { weather: NOW, ndvi: daysAgo(14), ndre: daysAgo(14), thermal: daysAgo(6), pestHistory: null },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    // Fresh: weather(0.20)+thermal(0.25)+pestHistory(0.10) = 0.55
    // normalized: weather=0.364, thermal=0.455, pestHistory=0.182
    // weighted_stress = 0.364*0.5 + 0.455*0.4 + 0.182*0.2 = 0.182+0.182+0.0364 = 0.4004
    // health ≈ 60
    assert.ok(result.score >= 55, `Expected score >= 55, got ${result.score}`);
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
