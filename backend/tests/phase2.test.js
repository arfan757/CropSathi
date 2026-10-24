/**
 * phase2.test.js
 *
 * Test suite for Phase 2: Score Correctness & Component Renaming
 * Covers: TC-03, TC-04, TC-05, TC-06, TC-08, TC-09, TC-12, TC-15
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeNdviToScore,
  normalizeNdreToScore,
  computeCWSI,
  computeVegetationHealthScore,
  GROWTH_WEIGHTS,
  STAGE_TO_SCENARIO,
} from '../src/services/vegetationHealth.js';

import {
  evaluateWeatherForFarm,
} from '../src/services/weatherService.js';

import {
  isVegetationDetected,
} from '../src/services/ndviService.js';

import {
  computeRiskScore,
  getAlertThreshold,
  HealthLevel,
} from '../src/services/riskService.js';

import { RiskScoreDocument } from '../src/models/RiskScore.js';
import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import CropBaseline from '../src/models/CropBaseline.js';
import { migrateRiskComponents } from '../scripts/migrations/rename_risk_components.js';

const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('Phase 2 Test Suite', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // TC-03: NDVI=0.05, NDRE=0.05, sentinel-2 -> vegetationDetected false,
  // score null, components null, noVegetationDetected true
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-03: NDVI=0.05, NDRE=0.05 -> vegetationDetected false, score null, components null', () => {
    const vegDetected = isVegetationDetected(0.05, 0.05, 'sentinel-2');
    assert.equal(vegDetected, false, 'vegetationDetected must be false for NDVI=0.05, NDRE=0.05 on sentinel-2');

    // Verify simulated data fails open per spec
    assert.equal(isVegetationDetected(0.05, 0.05, 'simulated'), true);

    // Verify RiskScore model properties when vegetationDetected is false
    const scoreDoc = new RiskScoreDocument({
      farm_id: 'test_farm',
      scene_source: 'sentinel-2',
      no_vegetation_detected: !vegDetected,
      composite_score: vegDetected ? 50 : null,
      health_level: vegDetected ? 'watch' : null,
      ndvi_stress: vegDetected ? 0.9 : null,
      ndre_stress: vegDetected ? 0.9 : null,
      thermal_stress: vegDetected ? 0.5 : null,
      triggered_alert: vegDetected ? true : false,
    });

    assert.equal(scoreDoc.compositeScore, null, 'compositeScore must be null');
    assert.equal(scoreDoc.healthLevel, null, 'healthLevel must be null');
    assert.equal(scoreDoc.ndviStress, null, 'ndviStress must be null');
    assert.equal(scoreDoc.ndreStress, null, 'ndreStress must be null');
    assert.equal(scoreDoc.thermalStress, null, 'thermalStress must be null');
    assert.equal(scoreDoc.ndviComponent, null, 'ndviComponent must be null');
    assert.equal(scoreDoc.noVegetationDetected, true, 'noVegetationDetected must be true');
    assert.equal(scoreDoc.triggeredAlert, false, 'triggeredAlert must be false');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-04: cotton flowering, NDVI 0.75, baseline {0, 0.9} -> S_NDVI = 83.3
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-04: cotton flowering, NDVI 0.75, baseline {0, 0.9} -> S_NDVI = 83.3', () => {
    const baseline = { min: 0.0, max: 0.9 };
    const sNdvi = normalizeNdviToScore(0.75, baseline);
    assert.equal(sNdvi, 83.3);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-05: all signals max stress -> score 0, level HIGH, alert true
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-05: all signals max stress -> score 0, level HIGH, alert true', async () => {
    const origNdviFindOne = NdviReading.findOne;
    const origThermalFindOne = ThermalReading.findOne;
    const origBaselineFindOne = CropBaseline.findOne;

    NdviReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          ndvi: 0.0,
          ndre: -0.1,
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    ThermalReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          sceneSource: 'landsat-8-9',
          estimatedCanopyTempC: 45, // very high CWSI = 1.0 -> 0 score
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    CropBaseline.findOne = () => ({ lean: async () => null });

    try {
      const farm = {
        _id: 'farm_stressed',
        cropType: 'Cotton',
        cropStage: 'flowering',
        areaInHectares: 2.0,
      };
      const weather = { temperatureC: 30, humidityPct: 60 };

      const result = await computeVegetationHealthScore(farm, weather, NOW);

      assert.equal(result.score, 0, 'Score should be 0 when all signals are at maximum stress');
      assert.equal(result.level, HealthLevel.HIGH);
      assert.equal(result.triggeredAlert, true);
    } finally {
      NdviReading.findOne = origNdviFindOne;
      ThermalReading.findOne = origThermalFindOne;
      CropBaseline.findOne = origBaselineFindOne;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-06: single signal at max stress -> false-alarm gate holds, alert false
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-06: single signal at max stress -> false-alarm gate holds, alert false', async () => {
    const origNdviFindOne = NdviReading.findOne;
    const origThermalFindOne = ThermalReading.findOne;
    const origBaselineFindOne = CropBaseline.findOne;

    // Only NDVI at max stress (0 score), NDRE optimal (100 score), thermal optimal (100 score)
    NdviReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          ndvi: 0.0, // 0 score
          ndre: 0.70, // 100 score
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    ThermalReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          sceneSource: 'landsat-8-9',
          estimatedCanopyTempC: 24, // CWSI = 0 -> 100 score
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    CropBaseline.findOne = () => ({ lean: async () => null });

    try {
      const farm = {
        _id: 'farm_single_stress',
        cropType: 'Cotton',
        cropStage: 'flowering',
        areaInHectares: 2.0,
      };
      const weather = { temperatureC: 30, humidityPct: 60 };

      const result = await computeVegetationHealthScore(farm, weather, NOW);

      // Balanced weights: ndvi: 0.40, ndre: 0.40, thermal: 0.20
      // 0.40*0 + 0.40*100 + 0.20*100 = 60 -> WATCH (>= 60)
      assert.ok(result.score >= 60, `Score ${result.score} must be >= 60`);
      assert.equal(result.level, HealthLevel.WATCH);
      assert.equal(result.triggeredAlert, false, 'Single signal stress must not trigger alert');
    } finally {
      NdviReading.findOne = origNdviFindOne;
      ThermalReading.findOne = origThermalFindOne;
      CropBaseline.findOne = origBaselineFindOne;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-08: cropStage 'harvested' -> score null, triggeredAlert false
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-08: cropStage harvested -> score null, triggeredAlert false', async () => {
    const farm = {
      _id: 'farm_harvested',
      cropType: 'Cotton',
      cropStage: 'harvested',
      areaInHectares: 2.0,
    };

    const result = await computeVegetationHealthScore(farm, null, NOW);
    assert.equal(result.score, null);
    assert.equal(result.level, null);
    assert.equal(result.triggeredAlert, false);
    assert.equal(result.reason, 'harvested');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-09: drought conditions -> growthScenario 'drought', thermal weight 0.40
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-09: drought conditions -> growthScenario drought, thermal weight 0.40', async () => {
    const origNdviFindOne = NdviReading.findOne;
    const origThermalFindOne = ThermalReading.findOne;
    const origBaselineFindOne = CropBaseline.findOne;

    NdviReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          ndvi: 0.70,
          ndre: 0.60,
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    ThermalReading.findOne = () => ({
      sort: () => ({
        lean: async () => ({
          sceneSource: 'landsat-8-9',
          estimatedCanopyTempC: 32,
          cloudCoverPct: 5,
          observedAt: daysAgo(2),
        }),
      }),
    });

    CropBaseline.findOne = () => ({ lean: async () => null });

    try {
      const farm = {
        _id: 'farm_drought',
        cropType: 'Cotton',
        cropStage: 'flowering',
        areaInHectares: 2.0,
      };
      // Drought: temp > 35, rainfall < 2
      const droughtWeather = { temperatureC: 38, rainfallMm24h: 0.5, humidityPct: 30 };

      const result = await computeVegetationHealthScore(farm, droughtWeather, NOW);

      assert.equal(result.growthScenario, 'drought');
      assert.equal(result.weightsUsed.thermal, 0.40);
    } finally {
      NdviReading.findOne = origNdviFindOne;
      ThermalReading.findOne = origThermalFindOne;
      CropBaseline.findOne = origBaselineFindOne;
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-12: missing weather data -> reason 'no_weather_data', no hypothesis
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-12: missing weather data -> reason no_weather_data, no hypothesis', async () => {
    // When farm is missing or weather cannot be fetched, evaluateWeatherForFarm returns no_weather_data
    const farmWithoutStage = {
      _id: 'farm_nostage',
      cropType: 'Cotton',
      cropStage: null, // missing stage -> must not default to vegetative silently (F-15)
    };

    const evalResult = await evaluateWeatherForFarm(farmWithoutStage);
    assert.equal(evalResult.score, 0);
    assert.equal(evalResult.weatherRiskHypothesis, null);
    assert.equal(evalResult.diseaseHypothesis, null);
    assert.equal(evalResult.reason, 'no_weather_data');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // TC-15: migration: old documents with the old field names still read correctly
  // ──────────────────────────────────────────────────────────────────────────
  it('TC-15: old documents with old field names read correctly via read-compat layer', () => {
    const legacyRow = {
      id: 'legacy-risk-1',
      farm_id: 'farm-legacy',
      computed_at: '2026-08-10T12:00:00Z',
      ndvi_component: 0.65,
      ndre_component: 0.45,
      thermal_component: 0.25,
      composite_score: 55,
      health_level: 'elevated',
      triggered_alert: true,
      inputs_snapshot: {
        noVegetationDetected: false,
      },
    };

    const doc = new RiskScoreDocument(legacyRow);

    // Stress fields populated from legacy component fields
    assert.equal(doc.ndviStress, 0.65);
    assert.equal(doc.ndreStress, 0.45);
    assert.equal(doc.thermalStress, 0.25);

    // Read-compat properties preserved
    assert.equal(doc.ndviComponent, 0.65);
    assert.equal(doc.ndreComponent, 0.45);
    assert.equal(doc.thermalComponent, 0.25);

    assert.equal(doc.compositeScore, 55);
    assert.equal(doc.healthLevel, 'elevated');
    assert.equal(doc.noVegetationDetected, false);
  });

  it('TC-15b: migration script updates legacy records accurately', async () => {
    const mockStorage = [
      {
        id: 'rec-1',
        ndvi_component: 0.8,
        ndre_component: 0.7,
        thermal_component: 0.3,
        ndvi_stress: null,
        ndre_stress: null,
        thermal_stress: null,
        no_vegetation_detected: null,
        inputs_snapshot: { noVegetationDetected: true },
      },
    ];

    const mockClient = {
      from: () => ({
        select: () => ({
          limit: async () => ({ data: mockStorage, error: null }),
        }),
        update: (payload) => ({
          eq: async (col, val) => {
            const idx = mockStorage.findIndex(r => r.id === val);
            if (idx >= 0) Object.assign(mockStorage[idx], payload);
            return { error: null };
          },
        }),
      }),
    };

    const result = await migrateRiskComponents({ apply: true, client: mockClient });
    assert.equal(result.migratedCount, 1);
    assert.equal(mockStorage[0].ndvi_stress, 0.8);
    assert.equal(mockStorage[0].ndre_stress, 0.7);
    assert.equal(mockStorage[0].thermal_stress, 0.3);
    assert.equal(mockStorage[0].no_vegetation_detected, true);
  });
});
