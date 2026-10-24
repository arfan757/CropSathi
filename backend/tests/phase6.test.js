import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateObservation, importObservationsFromCsv } from '../scripts/calibration/ground_truth_schema.js';
import { runBacktest } from '../scripts/calibration/backtest.js';
import { recomputeBaselinesFromObservations } from '../scripts/calibration/recompute_baselines.js';
import { computeAnomalySubScore } from '../src/services/anomalyScoringService.js';

describe('Phase 6: Calibration & Validation Scaffolding (F-03, F-21)', () => {
  describe('Ground Truth Schema & CSV Importer', () => {
    it('validates a correct ground truth observation', () => {
      const validObs = {
        date: '2026-08-15',
        gps: { lat: 21.1458, lng: 79.0882 },
        crop: 'Cotton',
        stage: 'flowering',
        observedOutcome: 'confirmed_stress',
      };
      const res = validateObservation(validObs);
      assert.equal(res.valid, true);
      assert.equal(res.errors.length, 0);
    });

    it('rejects observations with invalid stage or outcome', () => {
      const invalidObs = {
        date: '2026-08-15',
        gps: { lat: 21.1458, lng: 79.0882 },
        crop: 'Cotton',
        stage: 'space_age_stage',
        observedOutcome: 'magical_cure',
      };
      const res = validateObservation(invalidObs);
      assert.equal(res.valid, false);
      assert.ok(res.errors.some(e => e.includes('Invalid stage')));
      assert.ok(res.errors.some(e => e.includes('Invalid outcome')));
    });

    it('parses and validates CSV observations successfully', () => {
      const csv = `date,farmId,latitude,longitude,crop,stage,observedOutcome,observedNdvi,observedNdre,notes
2026-08-15,farm_1,21.14,79.08,Cotton,flowering,confirmed_stress,0.42,0.35,Severe wilting observed
2026-08-16,farm_2,21.15,79.09,Rice,vegetative,healthy,0.78,0.71,Vigorous canopy
2026-08-17,farm_3,21.16,79.10,Wheat,flowering,false_alarm,0.65,0.58,Farmer photo showed weeds not disease`;

      const { records, errors } = importObservationsFromCsv(csv);
      assert.equal(errors.length, 0);
      assert.equal(records.length, 3);
      assert.equal(records[0].farmId, 'farm_1');
      assert.equal(records[0].observedOutcome, 'confirmed_stress');
      assert.equal(records[0].observedNdvi, 0.42);
      assert.equal(records[1].observedOutcome, 'healthy');
    });
  });

  describe('Backtest Engine', () => {
    it('computes TP, FP, FN, TN, FPR, FNR, and average lead time', () => {
      const observations = [
        // TP: Alert fired, ground truth confirmed stress
        { farmId: 'farm_tp', date: '2026-08-15', observedOutcome: 'confirmed_stress' },
        // FP: Alert fired, ground truth healthy (false alarm)
        { farmId: 'farm_fp', date: '2026-08-15', observedOutcome: 'healthy' },
        // FN: No alert, ground truth confirmed stress (missed detection)
        { farmId: 'farm_fn', date: '2026-08-15', observedOutcome: 'confirmed_stress' },
        // TN: No alert, ground truth healthy
        { farmId: 'farm_tn', date: '2026-08-15', observedOutcome: 'healthy' },
      ];

      const riskScores = [
        // Stressed score 3 days prior
        { farmId: 'farm_tp', compositeScore: 35, triggeredAlert: true, computedAt: '2026-08-12T10:00:00Z' },
        // Stressed score 2 days prior
        { farmId: 'farm_fp', compositeScore: 30, triggeredAlert: true, computedAt: '2026-08-13T10:00:00Z' },
        // Healthy score 4 days prior (missed)
        { farmId: 'farm_fn', compositeScore: 82, triggeredAlert: false, computedAt: '2026-08-11T10:00:00Z' },
        // Healthy score 1 day prior (correct non-alert)
        { farmId: 'farm_tn', compositeScore: 88, triggeredAlert: false, computedAt: '2026-08-14T10:00:00Z' },
      ];

      const report = runBacktest(observations, riskScores, { maxLeadDays: 14 });
      const { summary } = report;

      assert.equal(summary.totalObservations, 4);
      assert.equal(summary.truePositives, 1);
      assert.equal(summary.falsePositives, 1);
      assert.equal(summary.falseNegatives, 1);
      assert.equal(summary.trueNegatives, 1);
      assert.equal(summary.falsePositiveRate, 0.5); // FP / (FP + TN) = 1 / 2
      assert.equal(summary.falseNegativeRate, 0.5); // FN / (FN + TP) = 1 / 2
      assert.ok(summary.averageLeadTimeDays >= 2.5 && summary.averageLeadTimeDays <= 3.5);
    });
  });

  describe('Empirical Baseline Recomputation Tooling', () => {
    it('derives empirical min/max and writes new calibrationVersion', () => {
      const healthyObservations = [
        { crop: 'Cotton', stage: 'flowering', observedOutcome: 'healthy', observedNdvi: 0.70, observedNdre: 0.60 },
        { crop: 'Cotton', stage: 'flowering', observedOutcome: 'healthy', observedNdvi: 0.72, observedNdre: 0.62 },
        { crop: 'Cotton', stage: 'flowering', observedOutcome: 'healthy', observedNdvi: 0.75, observedNdre: 0.65 },
        { crop: 'Cotton', stage: 'flowering', observedOutcome: 'healthy', observedNdvi: 0.80, observedNdre: 0.68 },
        { crop: 'Cotton', stage: 'flowering', observedOutcome: 'healthy', observedNdvi: 0.85, observedNdre: 0.72 },
      ];

      const result = recomputeBaselinesFromObservations(healthyObservations, { minSampleSize: 5 });
      assert.ok(result.calibrationVersion.startsWith('v1.1.0-empirical'));
      assert.equal(result.calibrationStatus, 'calibrated');
      assert.ok(result.calibratedBaselines.cotton);
      assert.equal(result.calibratedBaselines.cotton.flowering.sampleCount, 5);
      assert.ok(result.calibratedBaselines.cotton.flowering.ndvi.min >= 0.65);
      assert.ok(result.calibratedBaselines.cotton.flowering.ndvi.max <= 0.90);
      assert.equal(result.cronConfig.enabled, false, 'Cron must be disabled by default');
    });

    it('skips cohorts with insufficient sample sizes', () => {
      const observations = [
        { crop: 'Wheat', stage: 'sowing', observedOutcome: 'healthy', observedNdvi: 0.35, observedNdre: 0.25 },
      ];
      const result = recomputeBaselinesFromObservations(observations, { minSampleSize: 5 });
      assert.equal(result.skippedCategories.length, 1);
      assert.equal(result.calibratedCropsCount, 0);
      assert.equal(result.calibrationStatus, 'literature_seed');
    });
  });

  describe('Anomaly Sub-score (Feature Flagged)', () => {
    it('falls back when FEATURE_ANOMALY_NDVI is disabled (default)', () => {
      const res = computeAnomalySubScore({
        currentValue: 0.45,
        cropType: 'Cotton',
        historicalValues: [0.7, 0.72, 0.75, 0.71, 0.73, 0.74, 0.76, 0.72, 0.71, 0.73],
      });
      assert.equal(res.usedAnomaly, false);
      assert.equal(res.reason, 'feature_flag_disabled');
    });
  });
});
