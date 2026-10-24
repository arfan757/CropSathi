# CropSathi Audit Fix Report

**Audit Date:** 2026-10-24  
**Implementation Date:** 2026-10-24  
**Target Architecture:** Node.js (ESM), Express.js, MongoDB / Supabase PostgreSQL, Copernicus Sentinel Hub, Open-Meteo, Landsat TIRS.

---

## 1. Findings Resolution Matrix (F-01 to F-21)

| Finding ID | Status | Files Changed | Test(s) | Notes |
|---|---|---|---|---|
| **F-01** | **Fixed** | `backend/src/models/RiskScore.js`<br>`backend/src/services/ndviService.js`<br>`backend/src/services/riskService.js` | TC-02 (`phase1.test.js`) | Added top-level `sceneSource` and `isSimulated` fields. Simulation gated strictly behind `ALLOW_SIMULATION === 'true'`. Alerts and notifications unconditionally suppressed for simulated data. |
| **F-02** | **Fixed** | `frontend/my-fields.html`<br>`backend/src/controllers/fieldController.js` | `phase5.test.js` | Field cards display health badge (Healthy/Watch/Elevated/High/Muted), numeric score, data age, satellite source, and confidence badge in batch without N+1 requests. |
| **F-03** | **Fixed** | `backend/src/config/vegetationHealth.js`<br>`backend/src/services/vegetationHealth.js`<br>`frontend/my-fields.html` | `phase3.test.js`<br>`phase6.test.js` | `calibrationVersion` and `calibrationStatus` ('literature_seed' \| 'calibrated') tracked. Confidence capped at 'medium' while in literature_seed status, and UI displays "Uncalibrated literature-seed thresholds in use" disclaimer. |
| **F-04** | **Fixed** | `backend/src/models/RiskScore.js`<br>`backend/src/services/weatherService.js`<br>`backend/src/services/riskService.js`<br>`backend/scripts/migrations/rename_disease_hypothesis.js` | `phase4.test.js` | Renamed `diseaseHypothesis` to `weatherRiskHypothesis` with read-compat layer and migration script. Copy updated to non-diagnostic wording: *"Weather conditions favorable for <disease>. Take a photo to confirm."* |
| **F-05** | **Fixed** | `backend/src/services/sentinelService.js`<br>`backend/src/models/NdviReading.js` | TC-10, TC-13 (`phase1.test.js`) | Fixed `observedAt` resolution via Copernicus Catalog Search API. If unresolvable, returns `null` and marks signal as stale (never defaults to today/endDate). Computes and stores `sceneAgeDays`. |
| **F-06** | **Fixed** | `backend/src/services/sentinelService.js` | TC-10 (`phase1.test.js`) | Capped satellite search retry window to avoid returning obsolete imagery as usable. Stale scenes are explicitly flagged `isStale: true`. |
| **F-07** | **Fixed** | `backend/src/models/RiskScore.js`<br>`backend/src/services/riskService.js`<br>`backend/src/services/vegetationHealth.js` | TC-03 (`phase2.test.js`) | When `vegetationDetected === false`, composite score, health level, and all stress components are saved as `null` with `noVegetationDetected = true`. Suppresses false disease alerts for misdrawn boundaries. |
| **F-08** | **Fixed** | `backend/src/services/thermalService.js`<br>`backend/src/services/vegetationHealth.js` | TC-11 (`phase1.test.js`) | `averageGrid` returns `null` for empty or missing thermal grids (removed arbitrary 30°C default). Callers handle `null`, and CWSI is skipped when canopy temperature is unavailable. |
| **F-09** | **Fixed** | `backend/src/services/vegetationHealth.js`<br>`backend/src/services/riskService.js`<br>`backend/tests/healthScore.test.js` | `healthScore.test.js`<br>`cropHealthPipeline.test.js` | Removed deprecated `computeFusedHealthScore`. Unified scoring under `computeVegetationHealthScore`. Exported canonical `STAGE_TO_SCENARIO` from `vegetationHealth.js`. |
| **F-10** | **Fixed** | `backend/src/services/ndviService.js`<br>`backend/src/services/riskService.js` | TC-02 (`phase1.test.js`) | Removed unseeded `Math.random()` anomaly injection. Implemented deterministic mulberry32 PRNG seeded with `farmId + date`. Alerts and notifications disabled for simulated scenes. Without credentials and flag, returns "no satellite data". |
| **F-11** | **Fixed** | `backend/src/services/ndviService.js` | `phase4.test.js` | Hotspot advisory copy updated to: *"Localized low-vigor patch detected. Inspect the field for the cause (disease, waterlogging, compaction, or nutrient deficiency)."* Removed premature root/vascular stress claim. |
| **F-12** | **Fixed** | `backend/src/models/Field.js`<br>`backend/src/controllers/fieldController.js`<br>`frontend/add-field.html`<br>`frontend/my-fields.html` | `phase4.test.js` | Added optional `variety` field and `stageSource` ('inferred' \| 'user'). UI presents stage source and user variety override without inventing variety calendars. |
| **F-13** | **Fixed** | `backend/src/services/vegetationHealth.js` | TC-07, TC-07b (`phase2.test.js`, `phase3.test.js`) | Implemented single-pass weight normalization across usable signals after dropping unavailable or formula-decoupled terms. Prevents inflated stress scores when signals are missing. |
| **F-14** | **Fixed** | `backend/src/models/RiskScore.js`<br>`backend/src/services/riskService.js` | `phase2.test.js` | Persists `thresholdUsed`, `growthScenario`, `cropStage`, `stageSource`, `staleSignals`, `calibrationVersion`, and active weights in `RiskScore`. |
| **F-15** | **Fixed** | `backend/src/services/weatherService.js` | TC-12 (`phase2.test.js`) | Removed silent fallback `cropStage = 'vegetative'`. When weather data or stage is unavailable, returns `{ score: 0, weatherRiskHypothesis: null, reason: 'no_weather_data' }`. |
| **F-16** | **Fixed** | `backend/src/controllers/fieldController.js`<br>`frontend/my-fields.html` | `phase5.test.js` | Enriched `/api/fields` response in batch with latest health scores. Field modal displays last scan date, signal breakdown (NDVI/NDRE/Thermal stress), and confidence factors. |
| **F-17** | **Fixed** | `backend/src/services/sentinelService.js`<br>`frontend/my-fields.html`<br>`docs/SCORING.md` | `phase4.test.js` | Applied inner buffer (-10m) to field coordinates before querying Copernicus. Flags low confidence if valid pixel count < 5. Added *"Small field (<1 ha): mixed-pixel risk"* UI note and documented NDRE B05 20m native resolution. |
| **F-18** | **Fixed** | `backend/src/controllers/monitoringController.js` | TC-14 (`phase1.test.js`) | When no risk score exists for a farm, returns `{ success: true, hasData: false, data: null }` (HTTP 200), eliminating fake score 50 default. |
| **F-19** | **Fixed** | `docs/BACKEND_SPEC.md`<br>`docs/FIELD_VALIDITY_VERIFICATION.md`<br>`docs/ARCHITECTURE.md`<br>`docs/SCORING.md` | Doc verification | Rewrote `BACKEND_SPEC.md` to reflect the real Node.js/Express stack. Corrected `FIELD_VALIDITY_VERIFICATION.md` to `NO_VEGETATION_NDVI = 0.20` and null score/level. Updated `ARCHITECTURE.md` and added `SCORING.md`. |
| **F-20** | **Fixed** | `backend/src/models/RiskScore.js`<br>`backend/scripts/migrations/rename_risk_components.js` | TC-15, TC-15b (`phase2.test.js`) | Renamed component fields to `ndviStress`, `ndreStress`, `thermalStress` (0-1 stress semantics). Added migration script and read-compat layer aliasing legacy `_component` fields. |
| **F-21** | **Fixed** | `backend/scripts/calibration/ground_truth_schema.js`<br>`backend/scripts/calibration/backtest.js`<br>`backend/scripts/calibration/recompute_baselines.js`<br>`backend/src/services/anomalyScoringService.js` | `phase6.test.js` | Created calibration directory with ground-truth schema, CSV import, backtest engine (computing FPR, FNR, lead time), and empirical baseline recalibration script with disabled cron. |

---

## 2. Test Verification Matrix (TC-01 to TC-15)

| Test Case | Scenario Description | Status | Test File & Line |
|---|---|---|---|
| **TC-01** | All signals null/stale -> score null, triggeredAlert false | **PASS** | `backend/tests/phase1.test.js:35` |
| **TC-02** | sceneSource 'simulated' -> triggeredAlert false, no notification | **PASS** | `backend/tests/phase1.test.js:65` |
| **TC-03** | NDVI=0.05, NDRE=0.05, sentinel-2 -> vegetationDetected false, score null, components null | **PASS** | `backend/tests/phase2.test.js:35` |
| **TC-04** | Cotton flowering, NDVI 0.75, baseline {0, 0.9} -> S_NDVI = 83.3 | **PASS** | `backend/tests/phase2.test.js:65` |
| **TC-05** | All signals max stress -> score 0, level HIGH, alert true (high/medium confidence) | **PASS** | `backend/tests/phase2.test.js:90` |
| **TC-06** | Single signal at max stress -> false-alarm gate holds, alert false | **PASS** | `backend/tests/phase2.test.js:140` |
| **TC-07** | NDVI/NDRE stale, thermal fresh with real LST -> thermal carries 100% of weight | **PASS** | `backend/tests/phase2.test.js:180` |
| **TC-07b** | Same, but thermal is formula-estimated -> score null (no usable signal) | **PASS** | `backend/tests/phase2.test.js:215` |
| **TC-08** | cropStage 'harvested' -> score null, triggeredAlert false | **PASS** | `backend/tests/phase2.test.js:240` |
| **TC-09** | Drought conditions -> growthScenario 'drought', thermal weight 0.40 | **PASS** | `backend/tests/phase2.test.js:265` |
| **TC-10** | observedAt 95 days old -> staleSignals include ndvi and ndre | **PASS** | `backend/tests/phase1.test.js:95` |
| **TC-11** | Empty thermal grid -> null canopy temp, CWSI skipped | **PASS** | `backend/tests/phase1.test.js:125` |
| **TC-12** | Missing weather data -> reason 'no_weather_data', no hypothesis | **PASS** | `backend/tests/phase2.test.js:290` |
| **TC-13** | observedAt unresolvable -> treated as stale, never "today" | **PASS** | `backend/tests/phase1.test.js:150` |
| **TC-14** | API with no stored score -> hasData false, no fake 50 | **PASS** | `backend/tests/phase1.test.js:180` |
| **TC-15** | Migration & read-compat: old documents with old field names read correctly | **PASS** | `backend/tests/phase2.test.js:315` |

---

## 3. Remaining Risks That Code Alone Cannot Solve

While all programmatic findings have been resolved, several operational and biophysical realities remain:

1. **Copernicus OAuth2 Credentials & Commercial Rate Limits:**
   - The application requires valid `COPERNICUS_CLIENT_ID` and `COPERNICUS_CLIENT_SECRET` credentials registered with the Copernicus Data Space Ecosystem.
   - Processing requests over multiple fields during cron runs must stay within API quota limits; otherwise, requests fail open and scores become stale.
2. **Empirical Ground-Truth Field Data:**
   - Crop spectral bounds currently run on literature seeds (`calibrationStatus = 'literature_seed'`).
   - The tooling created in `backend/scripts/calibration/` requires agronomist and farmer field observations (GPS, crop stage, confirmed stress vs false alarms) to transition to `calibrated` status.
3. **Monsoon Cloud Cover (Optical Blindness):**
   - Cloud cover > 40% correctly drops confidence to 'low', suppressing false alerts. However, during continuous multi-week monsoon cloud cover in western India (July–August), optical satellites cannot observe the surface. During these periods, monitoring depends entirely on weather risk and photo confirmation.
4. **Sub-Hectare Mixed Pixels:**
   - For smallholder farms (< 0.5 ha), Sentinel-2's 10m/20m pixels span field boundaries. While the -10m inner buffer reduces edge contamination, plots with narrow geometries may yield fewer than 5 pure crop pixels.
