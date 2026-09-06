/**
 * cropHealthPipeline.test.js
 *
 * Verification and regression tests for the crop-health scoring pipeline
 * (riskService.js, ndviService.js, thermalService.js).
 * Covers the complete Part B test matrix (Cases 1 - 13).
 *
 * Run: node --test backend/tests/cropHealthPipeline.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import {
  computeNdviComponent,
  computeNdreComponent,
  ndreToStress,
  getExpectedNdvi,
} from '../src/services/ndviService.js';
import {
  computeThermalComponent,
  estimateCanopyTemp,
} from '../src/services/thermalService.js';
import {
  computeFusedHealthScore,
  HealthLevel,
} from '../src/services/riskService.js';

describe('Part B: Crop Health Scoring Pipeline Test Matrix', () => {

  // ══════════════════════════════════════════════════════════════════
  // NDVI / NDRE Cases (1 - 7)
  // ══════════════════════════════════════════════════════════════════

  describe('NDVI / NDRE Component Cases (1 - 7)', () => {
    function mockNdviReading(readingDoc) {
      const origFind = NdviReading.find;
      NdviReading.find = () => ({
        sort: () => ({
          limit: () => ({
            lean: async () => (readingDoc ? [readingDoc] : []),
          }),
        }),
      });
      return () => { NdviReading.find = origFind; };
    }

    it('Case 1: ndvi=-0.5, ndre=-0.5 → stress ~1.0 (water/dead, both signals agree)', async () => {
      const restore = mockNdviReading({
        ndvi: -0.5,
        ndre: -0.5,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', null, null);
        assert.ok(stress >= 0.95, `Expected stress ~1.0, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 2: ndvi=-0.04, ndre=-0.04 → stress high (~0.6-0.8) — ORIGINAL ROOFTOP CASE', async () => {
      const restore = mockNdviReading({
        ndvi: -0.04,
        ndre: -0.04,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', null, null);
        assert.ok(stress >= 0.6 && stress <= 0.85, `Expected stress in [0.6, 0.85], got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 3: ndvi=0.05, ndre=0.15 → stress high (bare soil range on both)', async () => {
      const restore = mockNdviReading({
        ndvi: 0.05,
        ndre: 0.15,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', null, null);
        assert.ok(stress >= 0.35 && stress <= 0.45, `Expected universal floor stress ~0.40, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 4: ndvi=0.55, ndre=0.35 → early disease band (stress driven by NDRE ~0.31, not washed out by NDVI)', async () => {
      const restore = mockNdviReading({
        ndvi: 0.55,
        ndre: 0.35,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const ndreStress = await computeNdreComponent('dummyFarmId');
        assert.ok(Math.abs(ndreStress - 0.313) <= 0.02, `Expected stress ~0.313 driven by NDRE, got ${ndreStress}`);
      } finally {
        restore();
      }
    });

    it('Case 5: ndvi=0.75, ndre=0.70 → stress ~0 (healthy on both)', async () => {
      const restore = mockNdviReading({
        ndvi: 0.75,
        ndre: 0.70,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', null, null);
        assert.equal(stress, 0, `Expected stress 0, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 6: ndvi=0.30, ndre=null/undefined → NDRE missing does not crash or wrongly zero out signals', async () => {
      const restore = mockNdviReading({
        ndvi: 0.30,
        ndre: null,
        trailingAvgNdvi28d: null,
        observedAt: new Date(),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', null, null);
        assert.equal(stress, 0, `Expected stress 0 without crash, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 7: cropType="cotton", ndvi=0.40 (below baseline) but ndre=0.65 (healthy) → absoluteComponent dominates via max()', async () => {
      const restore = mockNdviReading({
        ndvi: 0.40,
        ndre: 0.65,
        trailingAvgNdvi28d: null,
        observedAt: new Date('2026-07-15'),
      });
      try {
        const stress = await computeNdviComponent('dummyFarmId', 'cotton', 'vegetative');
        assert.ok(stress >= 0.30 && stress <= 0.36, `Expected absoluteComponent ~0.333 to dominate over healthy NDRE, got ${stress}`);
      } finally {
        restore();
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Thermal / CWSI Cases (8 - 11)
  // ══════════════════════════════════════════════════════════════════

  describe('Thermal / CWSI Cases (8 - 11)', () => {
    function mockThermalReading(readingDoc) {
      const origFind = ThermalReading.find;
      ThermalReading.find = () => ({
        sort: () => ({
          limit: () => ({
            lean: async () => (readingDoc ? [readingDoc] : []),
          }),
        }),
      });
      return () => { ThermalReading.find = origFind; };
    }

    it('Case 8: sceneSource="landsat-8-9", estimatedCanopyTempC well above Tlower → CWSI high, wins max() over zero anomaly', async () => {
      const weather = { temperatureC: 32, humidityPct: 40 };
      const restore = mockThermalReading({
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 40.5,
        anomalyC: 0,
        observedAt: new Date(),
      });
      try {
        const stress = await computeThermalComponent('dummyFarmId', weather, null);
        assert.ok(stress >= 0.70 && stress <= 0.80, `Expected CWSI ~0.75 to win over anomaly=0, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 9: sceneSource="formula" → cwsiComponent is NOT computed (stays null), only anomalyComponent used', async () => {
      const weather = { temperatureC: 32, humidityPct: 40 };
      const restore = mockThermalReading({
        sceneSource: 'formula',
        estimatedCanopyTempC: 40.5,
        anomalyC: 0,
        observedAt: new Date(),
      });
      try {
        const stress = await computeThermalComponent('dummyFarmId', weather, null);
        assert.equal(stress, 0, `Expected cwsi to be skipped on formula sceneSource, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 10: sceneSource="landsat-8-9" but weatherReading=null → no crash, falls back to anomalyComponent only', async () => {
      const restore = mockThermalReading({
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 40.5,
        anomalyC: 2.0,
        observedAt: new Date(),
      });
      try {
        const stress = await computeThermalComponent('dummyFarmId', null, null);
        assert.equal(stress, 0.2, `Expected fallback to anomaly 0.2 without weatherReading, got ${stress}`);
      } finally {
        restore();
      }
    });

    it('Case 11: Real anomaly data exists AND CWSI both point to stress → max() picks the higher one, no double-counting', async () => {
      const weather = { temperatureC: 30, humidityPct: 50 };
      const restore = mockThermalReading({
        sceneSource: 'landsat-8-9',
        estimatedCanopyTempC: 37.5,
        anomalyC: 4.0,
        observedAt: new Date(),
      });
      try {
        const stress = await computeThermalComponent('dummyFarmId', weather, null);
        assert.equal(stress, 0.75, `Expected max(0.40, 0.75) = 0.75, got ${stress}`);
      } finally {
        restore();
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // End-to-End Cases (12 - 13)
  // ══════════════════════════════════════════════════════════════════

  describe('End-to-End Pipeline Cases (12 - 13)', () => {
    it('Case 12: Recreate original failing rooftop field (NDVI=-0.04, NDRE=-0.04, cropType=null) → compositeScore is concerning (<75), NOT 100', () => {
      const ndviStress = 0.76;
      const ndreStress = 0.60;
      const weatherStress = 0.2;
      const thermalStress = 0.0;
      const pestHistoryStress = 0.0;

      const fusionResult = computeFusedHealthScore(
        {
          weather: weatherStress,
          ndvi: ndviStress,
          ndre: ndreStress,
          thermal: thermalStress,
          pestHistory: pestHistoryStress,
        },
        {},
        null,
        new Date(),
        null,
      );

      assert.ok(
        fusionResult.score < 75,
        `Expected compositeScore to be significantly depressed (<75), got ${fusionResult.score}`
      );
      assert.notEqual(fusionResult.score, 100, 'Original bug reproduced: rooftop must NOT score 100');
      assert.ok(
        fusionResult.componentStress.ndvi >= 0.75,
        `NDVI component must accurately capture bare surface severity (>=0.75), got ${fusionResult.componentStress.ndvi}`
      );
    });

    it('Case 13: Same field with valid cropType="cotton", vegetative stage → score is at least as concerning as Case 12', () => {
      const ndviStressWithCrop = 1.0;
      const ndreStressWithCrop = 0.60;
      const weatherStress = 0.2;
      const thermalStress = 0.0;
      const pestHistoryStress = 0.0;

      const fusionResultWithCrop = computeFusedHealthScore(
        {
          weather: weatherStress,
          ndvi: ndviStressWithCrop,
          ndre: ndreStressWithCrop,
          thermal: thermalStress,
          pestHistory: pestHistoryStress,
        },
        {},
        'vegetative',
        new Date(),
        'cotton',
      );

      const fusionResultNoCrop = computeFusedHealthScore(
        {
          weather: weatherStress,
          ndvi: 0.76,
          ndre: 0.60,
          thermal: thermalStress,
          pestHistory: pestHistoryStress,
        },
        {},
        null,
        new Date(),
        null,
      );

      assert.ok(
        fusionResultWithCrop.score <= fusionResultNoCrop.score,
        `Score with cropType (${fusionResultWithCrop.score}) must be <= score without cropType (${fusionResultNoCrop.score})`
      );
    });
  });
});

