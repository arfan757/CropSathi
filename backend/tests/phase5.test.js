import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatFieldHealthScore } from '../src/controllers/fieldController.js';

describe('Phase 5: Frontend Batch Enrichment & Field Health Presentation (F-02, F-16)', () => {
  it('formats null score as hasData=false with null compositeScore', () => {
    const formatted = formatFieldHealthScore(null);
    assert.equal(formatted.hasData, false);
    assert.equal(formatted.compositeScore, null);
    assert.equal(formatted.healthLevel, null);
    assert.equal(formatted.confidence, 'low');
    assert.equal(formatted.triggeredAlert, false);
    assert.equal(formatted.noVegetationDetected, false);
    assert.equal(formatted.components.ndviStress, null);
  });

  it('formats simulated score with isSimulated=true and low confidence', () => {
    const rawScore = {
      composite_score: 72,
      health_level: 'watch',
      scene_source: 'simulated',
      is_simulated: true,
      confidence: 'low',
      confidence_reasons: ['simulated_data'],
      scene_age_days: 0,
      triggered_alert: false,
    };
    const formatted = formatFieldHealthScore(rawScore);
    assert.equal(formatted.hasData, true);
    assert.equal(formatted.isSimulated, true);
    assert.equal(formatted.compositeScore, 72);
    assert.equal(formatted.healthLevel, 'watch');
    assert.equal(formatted.confidence, 'low');
    assert.equal(formatted.triggeredAlert, false);
  });

  it('formats noVegetationDetected with null score and noVegetationDetected=true', () => {
    const rawScore = {
      composite_score: null,
      health_level: null,
      no_vegetation_detected: true,
      scene_source: 'sentinel-2',
      confidence: 'low',
      triggered_alert: false,
    };
    const formatted = formatFieldHealthScore(rawScore);
    assert.equal(formatted.hasData, true);
    assert.equal(formatted.noVegetationDetected, true);
    assert.equal(formatted.compositeScore, null);
    assert.equal(formatted.triggeredAlert, false);
  });

  it('formats regular Sentinel-2 score with components and confidence', () => {
    const rawScore = {
      composite_score: 84.5,
      health_level: 'healthy',
      scene_source: 'sentinel-2',
      is_simulated: false,
      scene_age_days: 3,
      cloud_cover_pct: 12.4,
      confidence: 'high',
      confidence_reasons: [],
      triggered_alert: false,
      weather_risk_hypothesis: 'Blast',
      ndvi_stress: 0.12,
      ndre_stress: 0.15,
      thermal_stress: 0.20,
    };
    const formatted = formatFieldHealthScore(rawScore);
    assert.equal(formatted.hasData, true);
    assert.equal(formatted.compositeScore, 84.5);
    assert.equal(formatted.healthLevel, 'healthy');
    assert.equal(formatted.sceneSource, 'sentinel-2');
    assert.equal(formatted.isSimulated, false);
    assert.equal(formatted.sceneAgeDays, 3);
    assert.equal(formatted.cloudCoverPct, 12.4);
    assert.equal(formatted.confidence, 'high');
    assert.equal(formatted.weatherRiskHypothesis, 'Blast');
    assert.equal(formatted.components.ndviStress, 0.12);
    assert.equal(formatted.components.ndreStress, 0.15);
    assert.equal(formatted.components.thermalStress, 0.20);
  });
});
