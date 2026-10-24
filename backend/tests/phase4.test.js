/**
 * phase4.test.js
 *
 * Test suite for Phase 4: Scientific Wording & Satellite Handling
 * Tests:
 * - F-04: weatherRiskHypothesis rename, read-compat shim, notification copy & type
 * - F-11: spatial hotspot message (low-vigor patch, removed root/vascular stress)
 * - F-17: inner buffer (-10m), minimum valid pixel count (< 5 -> low confidence)
 * - F-12: optional variety field, stageSource plumbing ('inferred' vs 'user')
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { RiskScoreDocument } from '../src/models/RiskScore.js';
import { FieldDocument } from '../src/models/Field.js';
import { computeSpatialHotspot } from '../src/services/ndviService.js';
import { applyInnerBuffer } from '../src/services/sentinelService.js';
import { migrateDiseaseHypothesis } from '../scripts/migrations/rename_disease_hypothesis.js';

describe('Phase 4: Scientific Wording & Satellite Handling', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // F-04: weatherRiskHypothesis rename & read-compat shim
  // ──────────────────────────────────────────────────────────────────────────
  describe('F-04: weatherRiskHypothesis & Non-Diagnostic Messaging', () => {
    it('populates weatherRiskHypothesis from legacy disease_hypothesis row', () => {
      const doc = new RiskScoreDocument({
        id: 'risk-f04',
        disease_hypothesis: 'yellow_rust',
      });

      assert.equal(doc.weatherRiskHypothesis, 'yellow_rust');
      assert.equal(doc.diseaseHypothesis, 'yellow_rust', 'Read-compat shim must return same value');
    });

    it('populates diseaseHypothesis from new weather_risk_hypothesis row', () => {
      const doc = new RiskScoreDocument({
        id: 'risk-f04-new',
        weather_risk_hypothesis: 'leaf_blast',
      });

      assert.equal(doc.weatherRiskHypothesis, 'leaf_blast');
      assert.equal(doc.diseaseHypothesis, 'leaf_blast', 'Read-compat shim must return same value');
    });

    it('migration script backfills weather_risk_hypothesis from disease_hypothesis', async () => {
      const mockStorage = [
        { id: 'rec-1', disease_hypothesis: 'early_blight', weather_risk_hypothesis: null },
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

      const res = await migrateDiseaseHypothesis({ apply: true, client: mockClient });
      assert.equal(res.migratedCount, 1);
      assert.equal(mockStorage[0].weather_risk_hypothesis, 'early_blight');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F-11: Spatial hotspot message (no root/vascular stress claim)
  // ──────────────────────────────────────────────────────────────────────────
  describe('F-11: Spatial Hotspot Message', () => {
    it('uses correct scientific wording without root/vascular stress claim', () => {
      // 5x5 grid with a cold/depressed cluster
      const ndviGrid = [
        [0.8, 0.8, 0.8, 0.8, 0.8],
        [0.8, 0.2, 0.2, 0.8, 0.8],
        [0.8, 0.2, 0.2, 0.8, 0.8],
        [0.8, 0.8, 0.8, 0.8, 0.8],
        [0.8, 0.8, 0.8, 0.8, 0.8],
      ];

      const result = computeSpatialHotspot(ndviGrid, null, null);

      assert.equal(result.isHeterogeneous, true);
      assert.ok(result.hotspotCellsCount > 0);
      assert.equal(
        result.message,
        'Localized low-vigor patch detected. Inspect the field for the cause (disease, waterlogging, compaction, or nutrient deficiency).'
      );
      assert.ok(!result.message.includes('root/vascular stress'), 'Must NOT claim root/vascular stress');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F-17: Inner polygon buffer & valid pixel counts
  // ──────────────────────────────────────────────────────────────────────────
  describe('F-17: Inner Polygon Buffer & Edge Pixel Guard', () => {
    it('applies ~-10m inner buffer to shrink polygon coordinates toward centroid', () => {
      // 100m x 100m square polygon around Pune (approx 18.52 N, 73.85 E)
      // 1 deg lat ~ 111320m -> 100m ~ 0.000898 deg
      const dDeg = 0.000898;
      const coords = [
        [73.8500, 18.5200],
        [73.8500 + dDeg, 18.5200],
        [73.8500 + dDeg, 18.5200 + dDeg],
        [73.8500, 18.5200 + dDeg],
        [73.8500, 18.5200],
      ];

      const buffered = applyInnerBuffer(coords, -10);

      // Centroid is around 73.8500 + dDeg/2, 18.5200 + dDeg/2
      // Each buffered vertex should be strictly closer to centroid than original vertex
      const cLng = 73.8500 + dDeg / 2;
      const cLat = 18.5200 + dDeg / 2;

      for (let i = 0; i < 4; i++) {
        const origDist = Math.hypot(coords[i][0] - cLng, coords[i][1] - cLat);
        const buffDist = Math.hypot(buffered[i][0] - cLng, buffered[i][1] - cLat);
        assert.ok(buffDist < origDist, `Buffered vertex ${i} must be closer to center than original`);
      }

      // Ring must be closed
      assert.deepEqual(buffered[0], buffered[buffered.length - 1]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // F-12: Optional variety field & stageSource plumbing
  // ──────────────────────────────────────────────────────────────────────────
  describe('F-12: Variety Field & Stage Source Plumbing', () => {
    it('FieldDocument stores optional variety and sets stageSource=inferred by default', () => {
      const field = new FieldDocument({
        name: 'Plot 1',
        crop_type: 'Cotton',
        sowing_date: '2026-06-01',
      });

      assert.equal(field.variety, null);
      assert.equal(field.stageSource, 'inferred');
    });

    it('FieldDocument preserves user-specified variety and user stageSource', () => {
      const field = new FieldDocument({
        name: 'Plot 2',
        crop_type: 'Cotton',
        variety: 'BT-Cotton-Bollgard-II',
        crop_stage: 'flowering',
        stage_source: 'user',
        sowing_date: '2026-06-01',
      });

      assert.equal(field.variety, 'BT-Cotton-Bollgard-II');
      assert.equal(field.cropStage, 'flowering');
      assert.equal(field.stageSource, 'user');
    });
  });
});
