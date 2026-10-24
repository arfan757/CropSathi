# CropSathi — Backend Specification

**Current Production Stack:**
- **Runtime:** Node.js (v18+ ESM)
- **Framework:** Express.js
- **Primary Databases:**
  - MongoDB (via Mongoose ODM) for core application entities (Users, Fields, NdviReadings, ThermalReadings, DiagnosisCases).
  - PostgreSQL via Supabase client for scalable spatial queries, analytics history, and risk score persistence (`risk_scores`, `field_observations`).
- **Satellite Ingestion:**
  - Copernicus Data Space Ecosystem / Sentinel Hub (OAuth2 client credentials, Catalog Search API, Process API).
  - Thermal infrared data via Landsat 8/9 LST processing.
- **Meteorological Data:**
  - Open-Meteo Weather API (historical & forecast hourly/daily: temperature, relative humidity, precipitation, VPD).
- **Computer Vision Inference:**
  - Server-side multi-model diagnosis ensemble wrapper for leaf disease confirmation.

---

## 1. Directory Structure

```
backend/
├── src/
│   ├── index.js                     # Express app initialization, middleware, routes, MongoDB connection
│   ├── config/                      # Environment configuration & scoring parameters
│   │   ├── vegetationHealth.js      # Calibrated baselines, weights, thresholds, confidence criteria
│   │   └── supabase.js              # Supabase PostgreSQL client setup
│   ├── controllers/                 # Request handlers
│   │   ├── authController.js        # Authentication & JWT issuance
│   │   ├── fieldController.js       # Field boundary management & batch health enrichment
│   │   ├── monitoringController.js  # Sentinel-2/Thermal ingest & latest risk endpoints
│   │   ├── diagnosisController.js   # Leaf photo diagnostic pipeline
│   │   └── dashboardController.js   # Summary stats & health telemetry
│   ├── models/                      # Mongoose ODM schemas
│   │   ├── User.js                  # Farmer profiles & farm locations
│   │   ├── Field.js                 # GeoJSON/Polygon fields, variety, sowingDate, stageSource
│   │   ├── NdviReading.js           # Ingested optical bands, NDVI, NDRE, sceneAgeDays
│   │   ├── ThermalReading.js        # Canopy temperature, CWSI, thermal stress
│   │   ├── RiskScore.js             # Fused risk score document, stress components, confidence
│   │   ├── CropBaseline.js          # Crop-specific NDVI/NDRE baselines
│   │   └── DiagnosisCase.js         # Confirmed disease cases from photo analysis
│   ├── services/                    # Core computational engines
│   │   ├── sentinelService.js       # Copernicus Hub OAuth2, Catalog search, inner polygon buffer (-10m)
│   │   ├── ndviService.js           # Spectral index extraction & deterministic simulation gate
│   │   ├── thermalService.js        # CWSI derivation, grid average null propagation
│   │   ├── weatherService.js        # Open-Meteo ingestion, VPD calculation, non-diagnostic risk
│   │   ├── vegetationHealth.js      # 3-signal fusion score, single-pass weight normalization, confidence
│   │   ├── riskService.js           # End-to-end field analysis coordinator & alert dispatch
│   │   └── anomalyScoringService.js # Rolling cohort z-score anomaly scoring (feature-flagged)
│   ├── middleware/                  # Auth guards, role verification, error handlers
│   └── cron/                        # Background sync workers & scheduled polling
├── scripts/
│   ├── migrations/                  # DB migration scripts for backward-compatible schema changes
│   └── calibration/                 # Ground truth schema, CSV import, backtest engine, recalibration
└── tests/                           # Unit & integration test suites
```

---

## 2. Remote Sensing & Scoring Pipeline Architecture

### 2.1 Ingestion & Spatial Preprocessing
1. **Inner Polygon Buffering (`applyInnerBuffer`):**
   Before querying Copernicus Sentinel Hub or Landsat, the field boundary polygon is shrunk inward by approximately -10 meters (using local meters-per-degree projection). This prevents boundary contamination from surrounding roads, bare soil, or buildings.
2. **True Acquisition Timestamp:**
   Sentinel-2 acquisition timestamps are retrieved directly from the Copernicus Catalog Search API properties (`datetime`). If unresolvable, `observedAt` is set to `null` and the signal is treated as stale.
3. **Resolution Caveats:**
   - NDVI (B08/B04): Native 10m resolution.
   - NDRE (B05/B04): Band 5 is native 20m, resampled to 10m.
   - Fields < 1.0 ha are flagged in the UI for mixed-pixel risk.

### 2.2 Field Validity Gate
If both raw NDVI < 0.20 and NDRE < 0.20 on a real satellite scene:
- `noVegetationDetected` is set to `true`.
- Composite score, health level, and component stresses are set to `null`.
- No disease alert is fired.

### 2.3 Confidence Assessment Model
Each score computes `confidence` (`'high' | 'medium' | 'low'`):
- **High:** Sentinel-2 optical data, scene age < 7 days, cloud cover < 20%, calibrated status.
- **Medium:** Sentinel-2 optical data, scene age 7–14 days, or cloud cover 20–40%, or capped while `calibrationStatus = 'literature_seed'`.
- **Low:** Simulated data, scene age > 14 days, cloud cover > 40%, valid pixel count < 5, or uncalibrated dependency.
- **Alert Invariant:** When `confidence === 'low'`, `triggeredAlert` is unconditionally `false`.

### 2.4 Simulation Policy
- Simulation is strictly gated on `ALLOW_SIMULATION === 'true'`.
- Simulated data uses a deterministic PRNG seeded with `farmId + date`.
- Simulated scores set `sceneSource = 'simulated'`, `isSimulated = true`, `triggeredAlert = false`, and never fire push notifications or photo prompts.
- In production without Copernicus credentials and without `ALLOW_SIMULATION`, the system returns `{ hasData: false, data: null }` (no fake defaults).

---

## 3. Core API Endpoints

### Fields API (`/api/fields`)
- `GET /api/fields`: Returns all fields for the authenticated user, enriched in batch with standardized `healthScore` metadata (no N+1 database queries).
- `GET /api/fields/:id`: Returns single field with enriched `healthScore`.
- `POST /api/fields`: Validates polygon boundary (>= 3 points), checks vegetation presence, saves field with optional `variety` and `stageSource` (`user` vs `inferred`).
- `PUT /api/fields/:id`: Updates field boundary, variety, or crop stage.
- `DELETE /api/fields/:id`: Soft-deletes field record.

### Risk & Monitoring API (`/api/monitoring`)
- `GET /api/monitoring/risk/latest?farmId=...`: Returns latest risk score for farm. If no score exists, returns `{ hasData: false, data: null }` (HTTP 200).
- `POST /api/monitoring/risk/calculate`: Triggers risk score recalculation for a farm.

### Diagnosis API (`/api/diagnosis`)
- `POST /api/diagnosis/submit`: Farmer photo submission. Evaluates server-side ensemble CV model. Confirmed diseases are assigned only after photo analysis.
