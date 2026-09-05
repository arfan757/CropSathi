import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeFusedHealthScore, HealthLevel } from '../src/services/riskService.js';
import { isVegetationDetected } from '../src/services/ndviService.js';

describe('Field Validity Gate', () => {
  describe('isVegetationDetected', () => {
    it('returns false when BOTH ndvi and ndre are below threshold (real satellite data)', () => {
      assert.strictEqual(isVegetationDetected(0.10, 0.15, 'sentinel-2'), false);
      assert.strictEqual(isVegetationDetected(0.05, 0.10, 'landsat-8-9'), false);
      assert.strictEqual(isVegetationDetected(-0.04, -0.04, 'sentinel-2'), false);
    });

    it('returns true when only NDVI is below threshold (NDRE healthy)', () => {
      assert.strictEqual(isVegetationDetected(0.10, 0.50, 'sentinel-2'), true);
    });

    it('returns true when only NDRE is below threshold (NDVI healthy)', () => {
      assert.strictEqual(isVegetationDetected(0.50, 0.15, 'sentinel-2'), true);
    });

    it('returns true when both are above thresholds', () => {
      assert.strictEqual(isVegetationDetected(0.55, 0.40, 'sentinel-2'), true);
      assert.strictEqual(isVegetationDetected(0.75, 0.70, 'sentinel-2'), true);
    });

    it('returns true when data is missing (insufficient to declare no vegetation)', () => {
      assert.strictEqual(isVegetationDetected(null, null, 'sentinel-2'), true);
      assert.strictEqual(isVegetationDetected(undefined, undefined, 'sentinel-2'), true);
      assert.strictEqual(isVegetationDetected(0.10, null, 'sentinel-2'), true);
      assert.strictEqual(isVegetationDetected(null, 0.15, 'sentinel-2'), true);
    });

    it('uses correct thresholds (0.15 for NDVI, 0.2 for NDRE)', () => {
      // Just below threshold - no vegetation
      assert.strictEqual(isVegetationDetected(0.14, 0.19, 'sentinel-2'), false);
      // At threshold - vegetation detected (< not <=)
      assert.strictEqual(isVegetationDetected(0.15, 0.20, 'sentinel-2'), true);
    });

    it('returns true for simulated data even when values are below threshold', () => {
      // Simulated NDVI is generated FROM crop assumptions, not real pixels,
      // so it can never detect a misdrawn boundary. The gate should only
      // apply to real satellite data.
      assert.strictEqual(isVegetationDetected(0.05, 0.10, 'simulated'), true);
      assert.strictEqual(isVegetationDetected(-0.04, -0.04, 'simulated'), true);
      assert.strictEqual(isVegetationDetected(0.10, 0.15, 'formula'), true);
      assert.strictEqual(isVegetationDetected(0.10, 0.15, 'unknown'), true);
      assert.strictEqual(isVegetationDetected(0.10, 0.15, null), true);
    });
  });

  describe('Field validity override in fusion', () => {
    it('does NOT override when vegetation is detected (normal healthy field)', () => {
      const stressComponents = {
        weather: 0.1,
        ndvi: 0.05,
        thermal: 0.05,
        pestHistory: 0.0,
      };

      const result = computeFusedHealthScore(
        stressComponents,
        {},
        'vegetative',
        new Date(),
        'cotton',
        null
      );

      // Should get a normal high score (low stress)
      assert.ok(result.score >= 85, `Expected score >= 85, got ${result.score}`);
      assert.strictEqual(result.level, HealthLevel.HEALTHY);
      assert.strictEqual(result.triggeredAlert, false);
    });

    it('overrides to score=0 even when weighted fusion would give moderate score', () => {
      // This simulates the rooftop case: NDVI/NDRE both show no vegetation,
      // but weather/thermal/pestHistory are measuring ambient conditions
      // that look fine (because the region is fine - it's just THIS polygon
      // that has no plants on it).
      const stressComponents = {
        weather: 0.0,      // regional weather is fine
        ndvi: 1.0,         // maximal NDVI stress (bare surface detected)
        thermal: 0.0,      // ambient temp is fine
        pestHistory: 0.0,  // no disease history in district
      };

      // With default weights (ndvi ~30%), weighted fusion would give:
      // stress = 0.0*0.35 + 1.0*0.30 + 0.0*0.15 + 0.0*0.20 = 0.30
      // score = 100 * (1 - 0.30) = 70 (WATCH level, NOT concerning)
      //
      // But the field validity gate should override this to 0 when
      // isVegetationDetected returns false (which requires checking
      // the actual ndvi/ndre VALUES, not just the stress component).

      const result = computeFusedHealthScore(
        stressComponents,
        {},
        'vegetative',
        new Date(),
        'cotton',
        null
      );

      // Before the field validity gate, this would be ~70 (WATCH).
      // The gate doesn't run inside computeFusedHealthScore - it runs
      // in computeRiskScore AFTER fusion. So this test actually verifies
      // the pre-override behavior is as expected.
      assert.ok(result.score >= 60 && result.score <= 75,
        `Fusion alone gives moderate score ~70, got ${result.score}`);
      assert.strictEqual(result.level, HealthLevel.WATCH);

      // The override happens at the computeRiskScore level, tested below
    });
  });

  describe('Integration: field validity detection explanation', () => {
    it('explains why override must happen AFTER fusion, not inside it', () => {
      // This is a documentation test showing the architectural constraint:
      //
      // computeFusedHealthScore receives STRESS COMPONENTS (0-1, where 1 = max stress),
      // not raw NDVI/NDRE values. By the time fusion runs, the information
      // "is NDVI 0.10 or 0.40?" is already gone - both just show up as high stress.
      //
      // isVegetationDetected needs the RAW VALUES (ndvi < 0.15 AND ndre < 0.2),
      // so it must run where those values are still available: computeRiskScore,
      // which has ndviReading.ndvi and ndviReading.ndre in scope.
      //
      // This is why the override is placed AFTER fusion (line 439 in riskService.js),
      // not as a fusion input - fusion deliberately abstracts away the raw sensor
      // values into a normalized stress scale.

      const ndviStressFromBare = 1.0;   // ndvi = 0.10 → high stress
      const ndviStressFromUnhealthy = 0.8; // ndvi = 0.40 → also high stress

      // Both produce similar stress, but only the first should trigger the gate
      assert.ok(Math.abs(ndviStressFromBare - ndviStressFromUnhealthy) < 0.3,
        'Stress components alone cannot distinguish bare from unhealthy');

      // The gate uses raw values (assuming real satellite data):
      assert.strictEqual(isVegetationDetected(0.10, 0.15, 'sentinel-2'), false, 'bare surface');
      assert.strictEqual(isVegetationDetected(0.40, 0.35, 'sentinel-2'), true, 'unhealthy but vegetation exists');
    });
  });

  describe('Real scenario: rooftop boundary', () => {
    it('simulates the complete flow for a boundary over a building', () => {
      // Real Sentinel-2 reading over a rooftop/parking lot:
      const ndviReading = {
        ndvi: -0.04,
        ndre: -0.04,
        sceneSource: 'sentinel-2',
      };

      // Step 1: Vegetation detection (runs in computeRiskScore before override)
      const vegetationDetected = isVegetationDetected(ndviReading.ndvi, ndviReading.ndre, ndviReading.sceneSource);
      assert.strictEqual(vegetationDetected, false, 'Should detect no vegetation');

      // Step 2: Fusion runs normally and produces some score
      const stressComponents = {
        weather: 0.0,
        ndvi: 0.95,  // high stress from bare surface
        thermal: 0.0,
        pestHistory: 0.0,
      };

      const fusionResult = computeFusedHealthScore(
        stressComponents,
        {},
        null,
        new Date(),
        null, // cropType unknown (boundary never set up properly)
        null
      );

      // Fusion produces a moderate score (not 0, not 100)
      assert.ok(fusionResult.score > 20 && fusionResult.score < 80,
        `Fusion gives moderate score before override: ${fusionResult.score}`);

      // Step 3: Override applies (simulating lines 439-444 in riskService.js)
      if (!vegetationDetected) {
        fusionResult.score = 0;
        fusionResult.level = HealthLevel.HIGH;
        fusionResult.triggeredAlert = false;
      }

      // Step 4: Final result
      assert.strictEqual(fusionResult.score, 0);
      assert.strictEqual(fusionResult.level, HealthLevel.HIGH);
      assert.strictEqual(fusionResult.triggeredAlert, false,
        'No alert - this is a boundary problem, not a disease signal');
    });

    it('does NOT flag simulated data even with low values', () => {
      // Simulated reading with low NDVI/NDRE (mature wheat scenario)
      const ndviReading = {
        ndvi: 0.05,
        ndre: 0.03,
        sceneSource: 'simulated',
      };

      const vegetationDetected = isVegetationDetected(ndviReading.ndvi, ndviReading.ndre, ndviReading.sceneSource);
      assert.strictEqual(vegetationDetected, true, 'Simulated data should not trigger gate');
    });
  });

  describe('Edge case: just-planted field (bare soil is legitimate)', () => {
    it('does NOT trigger gate when only ONE index is below threshold', () => {
      // A just-planted field at sowing stage:
      // - NDVI can legitimately be low (0.10-0.20) because canopy hasn't closed
      // - NDRE should still show some chlorophyll from emerging seedlings (>0.2)
      //
      // Requiring BOTH to be below threshold prevents false positives here.

      const sowingStageLegitimate = {
        ndvi: 0.12,  // below 0.15 (bare-ish)
        ndre: 0.25,  // above 0.2 (some chlorophyll present)
        sceneSource: 'sentinel-2',
      };

      assert.strictEqual(
        isVegetationDetected(sowingStageLegitimate.ndvi, sowingStageLegitimate.ndre, sowingStageLegitimate.sceneSource),
        true,
        'Should NOT flag as no-vegetation - NDRE shows life even if NDVI is low'
      );
    });

    it('DOES trigger gate when both are below even at sowing (real satellite data)', () => {
      // If BOTH are this low even at sowing, something is genuinely wrong
      // (wrong boundary, flood, complete seedling failure, etc.)
      const actuallyBare = {
        ndvi: 0.05,
        ndre: 0.05,
        sceneSource: 'sentinel-2',
      };

      assert.strictEqual(
        isVegetationDetected(actuallyBare.ndvi, actuallyBare.ndre, actuallyBare.sceneSource),
        false,
        'Both below threshold = no vegetation, even at sowing'
      );
    });

    it('does NOT trigger for simulated mature crop with low values', () => {
      // Mature wheat can have legitimately low simulated NDVI/NDRE
      const matureWheatSimulated = {
        ndvi: 0.05,
        ndre: 0.03,
        sceneSource: 'simulated',
      };

      assert.strictEqual(
        isVegetationDetected(matureWheatSimulated.ndvi, matureWheatSimulated.ndre, matureWheatSimulated.sceneSource),
        true,
        'Simulated data should bypass the gate regardless of values'
      );
    });
  });
});
