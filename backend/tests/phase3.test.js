/**
 * phase3.test.js
 *
 * Test suite for Phase 3: Confidence Model & Metadata
 * Tests:
 * - Confidence classification (high / medium / low) per Audit Section 7
 * - Alert suppression on low-confidence scores (Ground Rule 4)
 * - Decoupling of formula-estimated thermal from CWSI
 * - Propagation of cloud cover percent and scene age into stored records
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeConfidence,
  computeVegetationHealthScore,
} from '../src/services/vegetationHealth.js';

import { RiskScoreDocument } from '../src/models/RiskScore.js';
import NdviReading from '../src/models/NdviReading.js';
import ThermalReading from '../src/models/ThermalReading.js';
import CropBaseline from '../src/models/CropBaseline.js';

const NOW = new Date('2026-08-20T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('Phase 3: Confidence Model (Audit Section 7)', () => {

  describe('computeConfidence rules', () => {
    it('returns high confidence for sentinel-2, age < 7d, cloud < 20% when calibrated', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 3,
        cloudCoverPct: 10,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'high');
      assert.equal(result.reasons.length, 0);
    });

    it('caps confidence at medium while calibrationStatus is literature_seed', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 3,
        cloudCoverPct: 10,
        calibrationStatus: 'literature_seed',
      });

      assert.equal(result.confidence, 'medium');
      assert.ok(result.reasons.includes('literature_seed_calibration'));
    });

    it('returns medium confidence for sentinel-2 with age 7-14d', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 9,
        cloudCoverPct: 10,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'medium');
      assert.ok(result.reasons.includes('scene_age_7_to_14d'));
    });

    it('returns medium confidence for sentinel-2 with cloud 20-40%', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 3,
        cloudCoverPct: 25,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'medium');
      assert.ok(result.reasons.includes('cloud_20_to_40pct'));
    });

    it('returns low confidence when data is simulated', () => {
      const result = computeConfidence({
        sceneSource: 'simulated',
        isSimulated: true,
      });

      assert.equal(result.confidence, 'low');
      assert.ok(result.reasons.includes('simulated_data'));
    });

    it('returns low confidence when scene age > 14 days', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 16,
        cloudCoverPct: 5,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'low');
      assert.ok(result.reasons.includes('scene_age_gt_14d'));
    });

    it('returns low confidence when cloud cover > 40%', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 2,
        cloudCoverPct: 55,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'low');
      assert.ok(result.reasons.includes('cloud_gt_40pct'));
    });

    it('returns low confidence when valid pixel count < 5 (mixed-pixel risk, F-17)', () => {
      const result = computeConfidence({
        sceneSource: 'sentinel-2',
        sceneAgeDays: 2,
        cloudCoverPct: 5,
        validPixelCount: 3,
        calibrationStatus: 'calibrated',
      });

      assert.equal(result.confidence, 'low');
      assert.ok(result.reasons.includes('insufficient_valid_pixels'));
    });
  });

  describe('Alert gating on low confidence (Ground Rule 4)', () => {
    const baseFarm = {
      _id: 'farm_alert_gate',
      cropType: 'Cotton',
      cropStage: 'flowering',
      areaInHectares: 2.0,
    };

    it('suppresses alert on low-confidence reading even when score is HIGH (<40)', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const origBaselineFindOne = CropBaseline.findOne;

      // Both signals indicate severe stress, but cloud cover is 50% (>40% limit -> low confidence)
      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            ndvi: 0.10,
            ndre: 0.05,
            cloudCoverPct: 50, // high cloud -> low confidence
            observedAt: daysAgo(2),
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => null,
        }),
      });

      CropBaseline.findOne = () => ({ lean: async () => null });

      try {
        const result = await computeVegetationHealthScore(baseFarm, null, NOW);

        assert.ok(result.score < 40, `Score should be < 40, got ${result.score}`);
        assert.equal(result.confidence, 'low');
        assert.equal(result.triggeredAlert, false, 'triggeredAlert MUST be false when confidence is low');
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
        CropBaseline.findOne = origBaselineFindOne;
      }
    });

    it('fires alert when confidence is medium and score is HIGH (<40)', async () => {
      const origNdviFindOne = NdviReading.findOne;
      const origThermalFindOne = ThermalReading.findOne;
      const origBaselineFindOne = CropBaseline.findOne;

      // Stressed signals with age 9 days (medium confidence)
      NdviReading.findOne = () => ({
        sort: () => ({
          lean: async () => ({
            ndvi: 0.10,
            ndre: 0.05,
            cloudCoverPct: 10,
            observedAt: daysAgo(9), // 9 days -> medium confidence
            sceneSource: 'sentinel-2',
          }),
        }),
      });

      ThermalReading.findOne = () => ({
        sort: () => ({
          lean: async () => null,
        }),
      });

      CropBaseline.findOne = () => ({ lean: async () => null });

      try {
        const result = await computeVegetationHealthScore(baseFarm, null, NOW);

        assert.ok(result.score < 40, `Score should be < 40, got ${result.score}`);
        assert.equal(result.confidence, 'medium');
        assert.equal(result.triggeredAlert, true, 'triggeredAlert should be true when confidence is medium');
      } finally {
        NdviReading.findOne = origNdviFindOne;
        ThermalReading.findOne = origThermalFindOne;
        CropBaseline.findOne = origBaselineFindOne;
      }
    });
  });

  describe('Cloud cover and scene age metadata propagation', () => {
    it('persists and reads cloudCoverPct and sceneAgeDays in RiskScoreDocument', () => {
      const doc = new RiskScoreDocument({
        farm_id: 'farm-meta',
        confidence: 'medium',
        confidence_reasons: ['scene_age_7_to_14d'],
        cloud_cover_pct: 18.5,
        scene_age_days: 8,
      });

      assert.equal(doc.confidence, 'medium');
      assert.deepEqual(doc.confidenceReasons, ['scene_age_7_to_14d']);
      assert.equal(doc.cloudCoverPct, 18.5);
      assert.equal(doc.sceneAgeDays, 8);
    });
  });
});
