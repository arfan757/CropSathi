# Critical Fix: Field Validity Gate False Positives

**Date:** 2026-09-05  
**Issue:** Fields with vegetation showing score=0  
**Status:** ✅ FIXED AND TESTED

---

## Problem Report

After implementing the field validity gate, users reported that **fields with actual crops were showing score=0** ("No Vegetation" badge).

## Root Cause Analysis

### Investigation Results

Ran simulation of 1000 NDVI readings for different crops:

```
rice (vegetative):     0% false positives
cotton (flowering):    0% false positives  
wheat (maturity):      4.5% false positives ⚠️
```

### Why This Happened

1. **Simulated NDVI Generation Logic:**
   - Wheat baseline: 0.55
   - Maturity stage multiplier: 0.7
   - September seasonal: 0.95
   - **Base NDVI = 0.55 × 0.7 × 0.95 = 0.365**

2. **Anomaly Injection:**
   - 10% chance to subtract 0.15-0.30 from NDVI
   - Result: can drop to **0.045 NDVI**
   - NDRE follows: **0.033 NDRE**

3. **Gate Thresholds:**
   - NO_VEGETATION_NDVI = 0.15
   - NO_VEGETATION_NDRE = 0.2
   - Both indices below threshold → flagged as "no vegetation"

4. **Result:**
   - **Legitimate mature wheat fields randomly flagged 4.5% of the time**

---

## Why Simulated Data Can't Detect Boundary Errors

**Fundamental Issue:**

Simulated NDVI is generated **FROM crop assumptions** (type, stage), not from actual satellite pixels of the location.

- A field drawn over a rooftop gets simulated NDVI based on "wheat, maturity stage"
- The simulation produces plausible wheat values (~0.35-0.55)
- It never looks at real imagery, so it **cannot detect** that the boundary is over a building

**The field validity gate exists to catch real-world boundary errors**, not simulation artifacts.

---

## Solution Applied

### Code Change

**File:** `backend/src/services/ndviService.js`

```javascript
export function isVegetationDetected(ndvi, ndre, sceneSource) {
  // Only apply to REAL satellite data
  if (sceneSource !== 'sentinel-2' && sceneSource !== 'landsat-8-9') {
    return true; // bypass gate for simulated/unknown sources
  }

  const ndviBare = ndvi !== null && ndvi !== undefined && ndvi < NO_VEGETATION_NDVI;
  const ndreBare = ndre !== null && ndre !== undefined && ndre < NO_VEGETATION_NDRE;
  if (ndviBare && ndreBare) return false;
  return true;
}
```

### What Changed

**Before:**
- Gate applied to ALL NDVI readings (real + simulated)
- Mature crops with low simulated values → false positives

**After:**
- Gate applies ONLY to real satellite data (`sentinel-2`, `landsat-8-9`)
- Simulated data bypasses the gate entirely
- Real rooftop boundaries still detected correctly

---

## Impact Assessment

### ✅ Fixed Issues

1. **Mature crops no longer flagged incorrectly**
   - Wheat at maturity: 4.5% → 0% false positives
   - All simulated data bypasses the gate

2. **Real boundary errors still detected**
   - Sentinel-2 rooftop readings: correctly flagged
   - Landsat-8-9 bare surfaces: correctly flagged

3. **No regression in existing functionality**
   - All 87 tests pass
   - Health score computation unchanged for normal crops

### When the Gate Activates

**Will Trigger (score=0, "No Vegetation" badge):**
- Real Sentinel-2 NDVI < 0.15 AND NDRE < 0.2
- Real Landsat-8-9 NDVI < 0.15 AND NDRE < 0.2

**Will NOT Trigger (normal scoring):**
- Any simulated NDVI reading (regardless of values)
- Real satellite data with NDVI or NDRE above threshold
- Missing/null NDVI or NDRE values
- Unknown sceneSource

---

## Test Coverage

### New Tests Added (3)

1. **Simulated data bypass:**
   ```javascript
   isVegetationDetected(0.05, 0.10, 'simulated') === true
   ```

2. **Real rooftop still detected:**
   ```javascript
   isVegetationDetected(-0.04, -0.04, 'sentinel-2') === false
   ```

3. **Mature crop with simulated data:**
   ```javascript
   isVegetationDetected(0.05, 0.03, 'simulated') === true
   ```

### All Tests Pass ✅

- **87 total tests**
- **15 field validity gate tests**
- **72 existing health score tests**

---

## Files Modified

1. `backend/src/services/ndviService.js`
   - Added `sceneSource` parameter to `isVegetationDetected`
   - Bypass gate for non-satellite sources

2. `backend/src/services/riskService.js`
   - Pass `sceneSource` to `isVegetationDetected` call

3. `backend/tests/fieldValidityGate.test.js`
   - Updated all test calls to include `sceneSource`
   - Added 3 new tests for simulated data bypass

4. `backend/src/controllers/dashboardController.js`
   - Expose `noVegetationDetected` flag (no changes needed)

5. `frontend/dashboard.html`
   - Display "No Vegetation" badge (no changes needed)

6. `FIELD_VALIDITY_VERIFICATION.md`
   - Updated with fix details

---

## Production Behavior

### With Copernicus Credentials (Real Sentinel-2)

- All NDVI readings are `sceneSource: 'sentinel-2'`
- Gate **ACTIVE** for boundary validation
- Rooftop boundaries correctly detected
- Mature crops correctly scored (real satellite data shows actual vegetation)

### Without Copernicus Credentials (Simulated)

- All NDVI readings are `sceneSource: 'simulated'`
- Gate **BYPASSED** (simulated data can't detect boundary errors anyway)
- No false positives on mature crops
- Normal health scoring for all fields

---

## Verification Steps

1. ✅ Run all tests: `npm test` → 87 tests pass
2. ✅ Verify simulated mature wheat not flagged
3. ✅ Verify real Sentinel-2 rooftops still detected
4. ✅ Check user's fields: scores computed normally

---

## Conclusion

The fix correctly addresses the false positive issue while maintaining the ability to detect real boundary errors when satellite data is available.

**Key Insight:** The field validity gate is a **data quality check** for real satellite imagery, not a simulation validation tool. Simulated data inherently cannot detect misdrawn boundaries because it's generated from crop assumptions rather than actual pixel values.

The gate now only applies where it makes sense: **real satellite data that can actually detect vegetation presence at a specific location.**
