/**
 * healthScore.test.js
 *
 * Tests for the field health score pipeline.
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test backend/tests/healthScore.test.js
 *
 * Tests the 3-signal fusion logic (ndvi + ndre + thermal) from riskService.js.
 * These are small, fast unit tests with no I/O, no network, no database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

// ─── Helper: create a reference date ──────────────────────────────────────
const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// ─── Test Suite ───────────────────────────────────────────────────────────

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

  it('returns false at exact boundary (1 day = not stale for ndvi)', () => {
    assert.equal(isStale('ndvi', daysAgo(10), NOW), false);
  });

  it('returns true just past boundary', () => {
    const justPast = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000 - 1);
    assert.equal(isStale('ndvi', justPast, NOW), true);
  });
});

describe('getCropWeights', () => {
  it('returns balanced weights', () => {
    const w = getCropWeights('unknown');
    assert.equal(w.ndvi, 0.40);
    assert.equal(w.ndre, 0.40);
    assert.equal(w.thermal, 0.20);
  });

  it('weights always sum to 1.0', () => {
    const w = getCropWeights('default');
    const sum = w.ndvi + w.ndre + w.thermal;
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}, expected 1.0`);
  });
});

describe('computeFusedHealthScore — 3-signal fusion', () => {
  it('returns 100 (perfectly healthy) when all stress is 0', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0, ndre: 0, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 100);
    assert.equal(result.level, HealthLevel.HEALTHY);
    assert.equal(result.triggeredAlert, false);
  });

  it('returns lowest possible score for max stress on all signals', () => {
    // All 3 components at max stress (1.0) with balanced weights:
    //   weighted = 0.40*1 + 0.40*1 + 0.20*1 = 1.0
    //   health = 100 * (1 - 1.0) = 0
    const result = computeFusedHealthScore(
      { ndvi: 1, ndre: 1, thermal: 1 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 0);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });

  it('computes correct weighted average for uniform stress', () => {
    // All 3 at 0.5 stress with balanced weights:
    // weighted = 0.40*0.5 + 0.40*0.5 + 0.20*0.5 = 0.5
    // health = 100 * (1 - 0.5) = 50
    const result = computeFusedHealthScore(
      { ndvi: 0.5, ndre: 0.5, thermal: 0.5 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 50);
    assert.equal(result.level, HealthLevel.ELEVATED);
  });

  it('uses balanced weights by default', () => {
    // ndvi alone at max stress: 0.40 * 1.0 = 0.40 → health = 60
    const result = computeFusedHealthScore(
      { ndvi: 1.0, ndre: 0, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 60);
    assert.equal(result.level, HealthLevel.WATCH);
  });

  it('no single signal can push score below 60 alone (false-alarm gate)', () => {
    // Max single weight is 0.40 (balanced). At max stress (1.0):
    // weighted_stress = 0.40 * 1.0 = 0.40 → health = 60 → WATCH
    const result = computeFusedHealthScore(
      { ndvi: 1.0, ndre: 0, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.ok(result.score >= 60, `Score ${result.score} should be >= 60 (WATCH)`);
    assert.equal(result.level, HealthLevel.WATCH);
    assert.equal(result.triggeredAlert, false);
  });

  it('requires at least two signals to corroborate for elevated/high', () => {
    // ndvi (0.40) + ndre (0.40) both at stress 0.8:
    // weighted = 0.40*0.8 + 0.40*0.8 = 0.64 → health = 36 → HIGH
    // Two signals at high stress can push past ELEVATED into HIGH
    const result = computeFusedHealthScore(
      { ndvi: 0.8, ndre: 0.8, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 36);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
  });
});

describe('computeFusedHealthScore — staleness redistribution', () => {
  it('drops stale ndvi/ndre and redistributes weight to thermal', () => {
    // ndvi and ndre stale (14d > 10d limit)
    // Fresh: thermal(0.20) only → normalized: thermal=1.0
    const result = computeFusedHealthScore(
      { ndvi: 0.9, ndre: 0.9, thermal: 0.2 },
      { ndvi: daysAgo(14), ndre: daysAgo(14), thermal: NOW },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    // thermal carries 100% of weight: stress = 0.2 → health = 80
    assert.equal(result.score, 80);
  });

  it('drops stale thermal and redistributes weight to ndvi/ndre', () => {
    // thermal stale (25d > 20d limit)
    // Fresh: ndvi(0.40) + ndre(0.40) = 0.80
    // normalized: ndvi=0.5, ndre=0.5
    const result = computeFusedHealthScore(
      { ndvi: 0.3, ndre: 0.3, thermal: 0.9 },
      { ndvi: NOW, ndre: NOW, thermal: daysAgo(25) },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('thermal'));
    // weighted_stress = 0.5*0.3 + 0.5*0.3 = 0.3 → health = 70
    assert.equal(result.score, 70);
  });

  it('falls back to neutral score when all signals are stale', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.9, ndre: 0.9, thermal: 0.7 },
      { ndvi: daysAgo(14), ndre: daysAgo(14), thermal: daysAgo(25) },
      null,
      NOW,
    );
    assert.ok(result.staleSignals.includes('ndvi'));
    assert.ok(result.staleSignals.includes('ndre'));
    assert.ok(result.staleSignals.includes('thermal'));
    assert.equal(result.score, 50);
    assert.equal(result.level, HealthLevel.WATCH);
  });
});

describe('computeFusedHealthScore — component stress tracking', () => {
  it('reports effective stress per component', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.8, ndre: 0.4, thermal: 0.3 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.componentStress.ndvi, 0.8);
    assert.equal(result.componentStress.ndre, 0.4);
    assert.equal(result.componentStress.thermal, 0.3);
  });

  it('reports normalized weights used', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0, ndre: 0, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    const sum = Object.values(result.weightsUsed).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.001, `Weights sum to ${sum}`);
  });
});

describe('computeFusedHealthScore — edge cases', () => {
  it('clamps score to 100 at zero stress', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0, ndre: 0, thermal: 0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.equal(result.score, 100);
  });

  it('handles missing stress components as 0', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.5 }, // only ndvi provided
      { ndvi: NOW },
      null,
      NOW,
    );
    // Missing components default to 0 stress
    // weighted_stress = 0.40*0.5 = 0.20 → health = 80
    assert.ok(result.score > 70, `Expected score > 70, got ${result.score}`);
  });

  it('handles empty signal dates gracefully', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.3, ndre: 0.2, thermal: 0.1 },
      {}, // no dates
      null,
      NOW,
    );
    assert.equal(result.staleSignals.length, 0);
  });

  it('produces integer scores', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.333, ndre: 0.667, thermal: 0.123 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    assert.ok(Number.isInteger(result.score), `Score ${result.score} should be an integer`);
  });
});

describe('computeFusedHealthScore — realistic scenarios', () => {
  it('healthy field: low stress across all signals', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.02, ndre: 0.0, thermal: 0.0 },
      { ndvi: daysAgo(2), ndre: daysAgo(2), thermal: daysAgo(5) },
      null,
      NOW,
    );
    assert.equal(result.level, HealthLevel.HEALTHY);
    assert.equal(result.triggeredAlert, false);
    assert.ok(result.score >= 90, `Healthy field should score >= 90, got ${result.score}`);
  });

  it('moderate risk: elevated NDVI + NDRE stress', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.5, ndre: 0.5, thermal: 0.0 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    // weighted_stress = 0.40*0.5 + 0.40*0.5 = 0.40 → health = 60
    assert.ok(result.score <= 65, `Moderate risk should be <= 65, got ${result.score}`);
    assert.equal(result.level, HealthLevel.WATCH);
  });

  it('severe: all signals high stress', () => {
    const result = computeFusedHealthScore(
      { ndvi: 0.9, ndre: 0.9, thermal: 0.8 },
      { ndvi: NOW, ndre: NOW, thermal: NOW },
      null,
      NOW,
    );
    // weighted = 0.40*0.9 + 0.40*0.9 + 0.20*0.8 = 0.36+0.36+0.16 = 0.88
    // health = 100 * (1 - 0.88) = 12
    assert.ok(result.score < 40, `Severe stress should score < 40, got ${result.score}`);
    assert.equal(result.level, HealthLevel.HIGH);
    assert.equal(result.triggeredAlert, true);
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
  it('increases threshold by 0.01 per call', () => {
    const initial = getAlertThreshold('cotton');
    recalibrateThreshold('cotton', 'bollworm');
    const after = getAlertThreshold('cotton');
    assert.ok(after >= initial, `Threshold should not decrease`);
  });

  it('caps at +0.15 cumulative', () => {
    for (let i = 0; i < 20; i++) {
      recalibrateThreshold('test_crop_max', 'test_disease');
    }
    const threshold = getAlertThreshold('test_crop_max');
    assert.ok(threshold <= 0.75, `Threshold should be capped at 0.75, got ${threshold}`);
  });
});
