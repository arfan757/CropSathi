/**
 * phase1.test.js
 * ──────────────
 * Phase 1: Data Integrity unit tests.
 * Covers TC-01, TC-02, TC-10, TC-11, TC-13, TC-14.
 *
 * Run: node --test backend/tests/phase1.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import RiskScore from '../src/models/RiskScore.js';
import Field from '../src/models/Field.js';
import {
  computeVegetationHealthScore,
  computeCWSI,
  isStale,
} from '../src/services/vegetationHealth.js';
import {
  averageGrid as averageThermalGrid,
} from '../src/services/thermalService.js';
import {
  generateSimulatedNdvi,
  createDeterministicRandom,
} from '../src/services/ndviService.js';
import {
  shouldPromptForPhoto,
  computeRiskScore,
} from '../src/services/riskService.js';
import {
  resolveSentinelAcquisitionDate,
} from '../src/services/sentinelService.js';
import {
  getRiskLatestEndpoint,
} from '../src/controllers/monitoringController.js';

describe('Phase 1: Data Integrity & Ground Rules', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // TC-01: all signals null/stale -> score null, triggeredAlert false
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-01: all signals null/stale', () => {
    it('returns score: null and triggeredAlert: false when all signals are stale', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const now = new Date('2026-10-24T12:00:00Z');
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc01',
            ndvi: 0.7,
            ndre: 0.5,
            observedAt: ninetyDaysAgo,
            cloudCoverPct: 5,
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc01',
            estimatedCanopyTempC: 32,
            observedAt: ninetyDaysAgo,
            sceneSource: 'landsat-8-9',
            cloudCoverPct: 0,
          }),
        }),
      });

      try {
        const farm = { _id: 'farm-tc01', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
        const weather = { temperatureC: 30, humidityPct: 50 };
        const result = await computeVegetationHealthScore(farm, weather, now);

        assert.strictEqual(result.score, null, 'Score must be null when all signals are stale (no fake 50)');
        assert.strictEqual(result.triggeredAlert, false, 'triggeredAlert must be false when signals are stale');
        assert.ok(result.staleSignals.includes('ndvi'));
        assert.ok(result.staleSignals.includes('ndre'));
        assert.ok(result.staleSignals.includes('thermal'));
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
      }
    });

    it('returns score: null and triggeredAlert: false when no readings exist (null signals)', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;

      NdviReading.findOne = () => ({ sort: () => ({ lean: async () => null }) });
      ThermalReading.findOne = () => ({ sort: () => ({ lean: async () => null }) });

      try {
        const farm = { _id: 'farm-tc01-empty', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
        const result = await computeVegetationHealthScore(farm, null, new Date());

        assert.strictEqual(result.score, null, 'Score must be null when no satellite data exists');
        assert.strictEqual(result.triggeredAlert, false);
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-02: sceneSource 'simulated' -> triggeredAlert false, no notification
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-02: sceneSource "simulated"', () => {
    it('shouldPromptForPhoto returns false when sceneSource is simulated', () => {
      assert.strictEqual(shouldPromptForPhoto('high', { sceneSource: 'simulated' }), false);
      assert.strictEqual(shouldPromptForPhoto('elevated', { isSimulated: true }), false);
      assert.strictEqual(shouldPromptForPhoto('high', { confidence: 'low' }), false);
      assert.strictEqual(shouldPromptForPhoto('high', { isStale: true }), false);
      // Non-simulated high still prompts
      assert.strictEqual(shouldPromptForPhoto('high', { sceneSource: 'sentinel-2' }), true);
    });

    it('deterministic simulation produces identical results for same farmId + date', () => {
      const farm = { _id: 'farm-seed-123', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
      const date = new Date('2026-10-24T00:00:00Z');

      const sim1 = generateSimulatedNdvi(farm, date);
      const sim2 = generateSimulatedNdvi(farm, date);

      assert.strictEqual(sim1.ndvi, sim2.ndvi, 'Deterministic NDVI must match');
      assert.strictEqual(sim1.ndre, sim2.ndre, 'Deterministic NDRE must match');
      assert.strictEqual(sim1.cloudCoverPct, sim2.cloudCoverPct);
      assert.strictEqual(sim1.pixelCountPureCrop, sim2.pixelCountPureCrop);
    });

    it('deterministic simulation produces different results for different dates or farms', () => {
      const farm1 = { _id: 'farm-seed-A', cropType: 'cotton', cropStage: 'flowering' };
      const farm2 = { _id: 'farm-seed-B', cropType: 'cotton', cropStage: 'flowering' };
      const date1 = new Date('2026-10-24T00:00:00Z');
      const date2 = new Date('2026-10-25T00:00:00Z');

      const simA = generateSimulatedNdvi(farm1, date1);
      const simB = generateSimulatedNdvi(farm2, date1);
      const simA2 = generateSimulatedNdvi(farm1, date2);

      assert.notStrictEqual(simA.ndvi, simB.ndvi, 'Different farms should produce different values');
      assert.notStrictEqual(simA.ndvi, simA2.ndvi, 'Different dates should produce different values');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-10: observedAt 95 days old -> staleSignals include ndvi and ndre
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-10: observedAt 95 days old', () => {
    it('flags ndvi and ndre as stale when observedAt is 95 days old', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const now = new Date('2026-10-24T12:00:00Z');
      const ninetyFiveDaysAgo = new Date(now.getTime() - 95 * 24 * 60 * 60 * 1000);

      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc10',
            ndvi: 0.65,
            ndre: 0.45,
            observedAt: ninetyFiveDaysAgo,
            cloudCoverPct: 10,
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc10',
            estimatedCanopyTempC: 30,
            observedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // fresh 2 days old
            sceneSource: 'landsat-8-9',
            cloudCoverPct: 5,
          }),
        }),
      });

      try {
        const farm = { _id: 'farm-tc10', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
        const weather = { temperatureC: 30, humidityPct: 50 };
        const result = await computeVegetationHealthScore(farm, weather, now);

        assert.ok(result.staleSignals.includes('ndvi'), 'staleSignals must include ndvi');
        assert.ok(result.staleSignals.includes('ndre'), 'staleSignals must include ndre');
        assert.ok(!result.staleSignals.includes('thermal'), 'thermal is fresh and should not be stale');
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-11: empty thermal grid -> null canopy temp, CWSI skipped
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-11: empty thermal grid', () => {
    it('averageThermalGrid returns null for empty or null grid', () => {
      assert.strictEqual(averageThermalGrid([]), null, 'Empty array must return null');
      assert.strictEqual(averageThermalGrid(null), null, 'null must return null');
      assert.strictEqual(averageThermalGrid([[], []]), null, 'Empty 2D grid must return null');
      assert.strictEqual(averageThermalGrid([[null, undefined], [null]]), null, 'All-null grid must return null');
    });

    it('computeCWSI returns null cwsi and low confidence when tCanopy is null', () => {
      const result = computeCWSI({ tCanopy: null, tAir: 30, vpd: 2.0, cropType: 'cotton' });
      assert.strictEqual(result.cwsi, null);
      assert.strictEqual(result.confidence, 'low');
    });

    it('computeVegetationHealthScore skips thermal sub-score when estimatedCanopyTempC is null', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const now = new Date('2026-10-24T12:00:00Z');

      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc11',
            ndvi: 0.75,
            ndre: 0.55,
            observedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
            cloudCoverPct: 5,
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc11',
            estimatedCanopyTempC: null, // null canopy temp!
            observedAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
            sceneSource: 'landsat-8-9',
            cloudCoverPct: 0,
          }),
        }),
      });

      try {
        const farm = { _id: 'farm-tc11', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
        const weather = { temperatureC: 30, humidityPct: 50 };
        const result = await computeVegetationHealthScore(farm, weather, now);

        assert.strictEqual(result.normalizedScores.thermal, undefined, 'thermal sub-score must be skipped when canopy temp is null');
        assert.ok(result.score !== null, 'NDVI and NDRE still provide a score');
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-13: observedAt unresolvable', () => {
    it('resolveSentinelAcquisitionDate returns null when search fails (never today)', async () => {
      // Use out-of-bounds coordinates where no satellite scene can ever exist
      const bbox = { west: 190.0, south: 89.0, east: 191.0, north: 90.0 };
      const startDate = new Date('2026-08-01');
      const endDate = new Date('2026-10-24');

      const date = await resolveSentinelAcquisitionDate(bbox, startDate, endDate, 'invalid-token');
      assert.strictEqual(date, null, 'Must return null when unresolvable, never fallback to today or endDate');
    });

    it('treats reading with null observedAt as stale in computeVegetationHealthScore', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const now = new Date('2026-10-24T12:00:00Z');

      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            farmId: 'farm-tc13',
            ndvi: 0.7,
            ndre: 0.5,
            observedAt: null, // unresolvable date!
            cloudCoverPct: 0,
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => null,
        }),
      });

      try {
        const farm = { _id: 'farm-tc13', cropType: 'cotton', cropStage: 'flowering', areaInHectares: 2 };
        const result = await computeVegetationHealthScore(farm, null, now);

        assert.ok(result.staleSignals.includes('ndvi'), 'Unresolvable observedAt must be treated as stale');
        assert.ok(result.staleSignals.includes('ndre'), 'Unresolvable observedAt must be treated as stale');
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TC-14: API with no stored score -> hasData false, no fake 50
  // ─────────────────────────────────────────────────────────────────────────
  describe('TC-14: API with no stored score', () => {
    it('returns { success: true, hasData: false, data: null } when no score exists', async () => {
      const origFieldFindOne = Field.findOne;
      const origRiskScoreFindOne = RiskScore.findOne;

      Field.findOne = async () => ({ _id: 'farm-empty', userId: 'user-1' });
      RiskScore.findOne = () => ({ sort: () => ({ lean: async () => null }) });

      let responseData = null;
      let statusCode = null;

      const req = { params: { farmId: 'farm-empty' }, user: { id: 'user-1' } };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(payload) {
          responseData = payload;
          return this;
        },
      };

      try {
        await getRiskLatestEndpoint(req, res);

        assert.strictEqual(statusCode, 200);
        assert.strictEqual(responseData.success, true);
        assert.strictEqual(responseData.hasData, false, 'hasData must be false when no score exists');
        assert.strictEqual(responseData.data, null, 'data must be null (no fake score 50)');
      } finally {
        Field.findOne = origFieldFindOne;
        RiskScore.findOne = origRiskScoreFindOne;
      }
    });
  });
});
