/**
 * healthScore.test.js
 *
 * Tests for the field health score pipeline.
 * Uses Node's built-in test runner (node:test + node:assert).
 * Run: node --test backend/tests/healthScore.test.js
 *
 * Ported from deprecated computeFusedHealthScore to computeVegetationHealthScore
 * in accordance with F-09.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  healthLevelForScore,
  shouldPromptForPhoto,
  isStale,
  getAlertThreshold,
  recalibrateThreshold,
  HealthLevel,
} from '../src/services/riskService.js';

import {
  computeVegetationHealthScore,
} from '../src/services/vegetationHealth.js';

import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import CropBaseline from '../src/models/CropBaseline.js';

// ─── Helper: create a reference date ──────────────────────────────────────
const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

// Helper to mock readings for computeVegetationHealthScore
function mockMongooseReadings({ ndviDoc = null, thermalDoc = null, baselineDoc = null } = {}) {
  const origNdviFindOne = NdviReading.findOne;
  const origThermalFindOne = ThermalReading.findOne;
  const origBaselineFindOne = CropBaseline.findOne;

  NdviReading.findOne = () => ({
    sort: () => ({
      lean: async () => ndviDoc,
    }),
  });

  ThermalReading.findOne = () => ({
    sort: () => ({
      lean: async () => thermalDoc,
    }),
  });

  CropBaseline.findOne = () => ({
    lean: async () => baselineDoc,
  });

  return () => {
    NdviReading.findOne = origNdviFindOne;
    ThermalReading.findOne = origThermalFindOne;
    CropBaseline.findOne = origBaselineFindOne;
  };
}

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

  it('returns false at exact boundary (10 days = not stale for ndvi)', () => {
    assert.equal(isStale('ndvi', daysAgo(10), NOW), false);
  });

  it('returns true just past boundary', () => {
    const justPast = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000 - 1);
    assert.equal(isStale('ndvi', justPast, NOW), true);
  });
});

describe('computeVegetationHealthScore — 3-signal fusion (F-09)', () => {
  const baseFarm = {
    _id: 'farm123',
    cropType: 'Cotton',
    cropStage: 'flowering',
    areaInHectares: 2.0,
  };

  it('returns high health (>85, HEALTHY) when all signals are optimal', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.80,
        ndre: 0.70,
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 28,
        cloudCoverPct: 5,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.ok(result.score >= 85, `Expected score >= 85, got ${result.score}`);
      assert.equal(result.level, HealthLevel.HEALTHY);
      assert.equal(result.triggeredAlert, false);
      assert.equal(result.staleSignals.length, 0);
    } finally {
      restore();
    }
  });

  it('returns lowest possible score for max stress on all signals', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.0, // baseline min -> 0 score
        ndre: -0.1, // baseline min -> 0 score
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 45, // very hot canopy -> high CWSI -> 0 score
        cloudCoverPct: 5,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.ok(result.score <= 5, `Expected score <= 5, got ${result.score}`);
      assert.equal(result.level, HealthLevel.HIGH);
      assert.equal(result.triggeredAlert, true);
    } finally {
      restore();
    }
  });

  it('no single signal can push score below 60 alone (false-alarm gate)', async () => {
    // Only NDVI is stressed (0.20), NDRE and Thermal are optimal
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.20, // 0 score
        ndre: 0.75, // 100 score
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 28, // healthy
        cloudCoverPct: 5,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.ok(result.score >= 60, `Score ${result.score} should be >= 60 (WATCH)`);
      assert.equal(result.level, HealthLevel.WATCH);
      assert.equal(result.triggeredAlert, false);
    } finally {
      restore();
    }
  });

  it('requires at least two signals to corroborate for elevated/high alert', async () => {
    // NDVI and NDRE both stressed
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.20, // 0 score
        ndre: 0.15, // 0 score
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 28, // optimal thermal (~100 score, weight 0.25)
        cloudCoverPct: 5,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.ok(result.score < 40, `Expected score < 40, got ${result.score}`);
      assert.equal(result.level, HealthLevel.HIGH);
      assert.equal(result.triggeredAlert, true);
    } finally {
      restore();
    }
  });
});

describe('computeVegetationHealthScore — staleness redistribution (TC-07 / TC-07b)', () => {
  const baseFarm = {
    _id: 'farm123',
    cropType: 'Cotton',
    cropStage: 'flowering',
    areaInHectares: 2.0,
  };

  it('TC-07: drops stale ndvi/ndre; fresh real Landsat carries 100% of the weight', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.20,
        ndre: 0.15,
        cloudCoverPct: 5,
        observedAt: daysAgo(14), // stale (>10d)
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 24, // fresh real Landsat, well-watered (CWSI=0)
        cloudCoverPct: 5,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.ok(result.staleSignals.includes('ndvi'));
      assert.ok(result.staleSignals.includes('ndre'));
      assert.equal(result.weightsUsed.thermal, 1.0);
      assert.equal(result.weightsUsed.ndvi, 0);
      assert.equal(result.weightsUsed.ndre, 0);
      assert.ok(result.score >= 80, `Expected score >= 80, got ${result.score}`);
    } finally {
      restore();
    }
  });

  it('TC-07b: drops formula-estimated thermal from contributing to score', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.20,
        ndre: 0.15,
        cloudCoverPct: 5,
        observedAt: daysAgo(14), // stale
      },
      thermalDoc: {
        sceneSource: 'formula', // formula-estimated, not real Landsat
        estimatedCanopyTempC: 28,
        observedAt: daysAgo(3),
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.equal(result.score, null);
      assert.equal(result.triggeredAlert, false);
      assert.equal(result.reason, 'all_signals_stale');
    } finally {
      restore();
    }
  });

  it('TC-01: returns null score when all signals are stale', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.80,
        ndre: 0.70,
        cloudCoverPct: 5,
        observedAt: daysAgo(14), // stale
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 28,
        cloudCoverPct: 5,
        observedAt: daysAgo(25), // stale (>20d)
      },
    });

    try {
      const weather = { temperatureC: 30, humidityPct: 60 };
      const result = await computeVegetationHealthScore(baseFarm, weather, NOW);

      assert.equal(result.score, null);
      assert.equal(result.level, null);
      assert.equal(result.triggeredAlert, false);
      assert.equal(result.reason, 'all_signals_stale');
    } finally {
      restore();
    }
  });

  it('TC-08: harvested stage returns null score and false alert', async () => {
    const harvestedFarm = { ...baseFarm, cropStage: 'harvested' };
    const result = await computeVegetationHealthScore(harvestedFarm, null, NOW);

    assert.equal(result.score, null);
    assert.equal(result.level, null);
    assert.equal(result.triggeredAlert, false);
    assert.equal(result.reason, 'harvested');
  });

  it('TC-09: drought conditions set growthScenario drought and thermal weight 0.40', async () => {
    const restore = mockMongooseReadings({
      ndviDoc: {
        ndvi: 0.70,
        ndre: 0.60,
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
      thermalDoc: {
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 32,
        cloudCoverPct: 5,
        observedAt: daysAgo(2),
      },
    });

    try {
      const droughtWeather = { temperatureC: 38, rainfallMm24h: 0.5, humidityPct: 30 };
      const result = await computeVegetationHealthScore(baseFarm, droughtWeather, NOW);

      assert.equal(result.growthScenario, 'drought');
      assert.equal(result.weightsUsed.thermal, 0.40);
    } finally {
      restore();
    }
  });
});

describe('getAlertThreshold and recalibrateThreshold', () => {
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
