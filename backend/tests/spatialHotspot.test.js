import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeSpatialHotspot } from '../src/services/ndviService.js';

describe('computeSpatialHotspot (§4d)', () => {
  it('returns non-heterogeneous when grid is null or missing', () => {
    const res = computeSpatialHotspot(null);
    assert.strictEqual(res.isHeterogeneous, false);
    assert.strictEqual(res.hotspotCellsCount, 0);
  });

  it('returns non-heterogeneous when NDVI values are uniform (stdDev <= 0.10)', () => {
    // 10x10 uniform grid around 0.60 with small noise
    const grid = Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => 0.60 + (Math.random() - 0.5) * 0.02)
    );
    const res = computeSpatialHotspot(grid);
    assert.strictEqual(res.isHeterogeneous, false);
    assert.ok(res.stdDev <= 0.10);
    assert.strictEqual(res.hotspotCellsCount, 0);
  });

  it('detects heterogeneity and identifies hotspot cells when stdDev > 0.10', () => {
    // 10x10 grid: 90 cells healthy (~0.70), 10 cells depressed (~0.20)
    const grid = Array.from({ length: 10 }, (v, r) =>
      Array.from({ length: 10 }, (v, c) => (r === 0 ? 0.20 : 0.70))
    );
    const res = computeSpatialHotspot(grid);
    assert.strictEqual(res.isHeterogeneous, true);
    assert.ok(res.stdDev > 0.10, `Expected stdDev > 0.10, got ${res.stdDev}`);
    assert.strictEqual(res.hotspotCellsCount, 10);
    assert.strictEqual(res.hotspotCells.length, 10);
    assert.ok(res.message.includes('Localized anomaly detected'));
  });

  it('corroborates hotspot with thermal grid when hotspot cells are >1.5C warmer', () => {
    // NDVI grid with low patch at row 0
    const ndviGrid = Array.from({ length: 10 }, (v, r) =>
      Array.from({ length: 10 }, (v, c) => (r === 0 ? 0.20 : 0.70))
    );
    // Thermal grid with elevated temp at row 0 (35.0C vs 30.0C field average)
    const thermalGrid = Array.from({ length: 10 }, (v, r) =>
      Array.from({ length: 10 }, (v, c) => (r === 0 ? 35.0 : 30.0))
    );

    const res = computeSpatialHotspot(ndviGrid, null, thermalGrid);
    assert.strictEqual(res.isHeterogeneous, true);
    assert.strictEqual(res.thermalCorroboration, true);
    assert.ok(res.hotspotMeanTemp > res.fieldMeanTemp + 1.5);
  });

  it('does NOT trigger thermal corroboration when hotspot cells are NOT warmer', () => {
    const ndviGrid = Array.from({ length: 10 }, (v, r) =>
      Array.from({ length: 10 }, (v, c) => (r === 0 ? 0.20 : 0.70))
    );
    // Thermal grid is uniform 30.0C everywhere
    const thermalGrid = Array.from({ length: 10 }, () =>
      Array.from({ length: 10 }, () => 30.0)
    );

    const res = computeSpatialHotspot(ndviGrid, null, thermalGrid);
    assert.strictEqual(res.isHeterogeneous, true);
    assert.strictEqual(res.thermalCorroboration, false);
  });
});
