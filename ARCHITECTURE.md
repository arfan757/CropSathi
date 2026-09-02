# CropSathi — Technical Architecture

Companion to `PRD.md` (what it does) and `PHASES.md` (build order). This covers how it's built.

## 1. System Overview

![System architecture](architecture_diagram.png)

Farmer captures a photo (when prompted) → the Android app screens it offline with an on-device model → results sync when connectivity returns → the backend confirms the diagnosis, factors in weather/satellite risk, and generates advisory → confirmed cases feed the district-level hotspot map for officials and CROPSAP.

## 2. Components

### Android App — Farmer-Facing, Offline-First
- **Native Kotlin**, chosen over Flutter for tight camera + on-device ML integration
- **CameraX** for capture, with on-device leaf segmentation/cropping before inference to counter messy field backgrounds
- **TensorFlow Lite** (quantized, ~5–10MB) for instant offline screening
- **Room (SQLite)** as the offline queue — every diagnosis, photo, and GPS tag stored locally with a `synced` flag
- **WorkManager** pushes queued data to the backend opportunistically
- Multilingual UI (Marathi/Hindi/English); see `DESIGN.md` for the full visual system

### Backend — FastAPI (Python)
- **Diagnosis service** — heavier server-side ensemble model re-confirms the on-device result once online (two-tier accuracy)
- **Weather-risk service** — Open-Meteo (fallback: IMD API), rule-based risk score per crop-disease-district from humidity/temperature/rainfall thresholds
- **Satellite vegetation service** — NDVI/NDRE via Google Earth Engine (Sentinel-2 SR), trailing-average anomaly detection (see caveats below)
- **Thermal anomaly service** — currently simulated (weather-adjusted leaf-temperature baseline); real ground sensors are a future hardware phase
- **Risk Fusion Engine** — combines all of the above into one composite farm risk score
- **Advisory / IPM engine** — disease + severity + crop stage → IPM-first actions, dosage/frequency/timing, safe-input sourcing, referral triggers
- **Expert validation queue** — low-confidence or flagged cases route to reviewers; confirmations feed retraining
- **Scheduled jobs** (weather polling, satellite polling, retraining triggers) — see §6, these run as Vercel Cron Jobs for the testing deployment rather than a persistent Celery + Redis worker

### Data Layer
- **PostgreSQL + PostGIS** — makes district/taluka hotspot aggregation and CROPSAP-style geo queries fast and natural. For the testing deployment, use **Supabase** or a direct **Neon** project with PostGIS enabled — see §6, not Vercel's own Postgres offering
- **Object storage** — Supabase Storage or Vercel Blob for the testing deployment; self-hosted MinIO remains the plan if this moves off Vercel later

### Officer Dashboard — React + Leaflet/Mapbox
- Geo heatmaps of confirmed cases by district/taluka
- Disease trend charts and a CROPSAP-style scouting overlay
- Expert-validation review queue and alert broadcast controls

### Model Training
- **PyTorch**, transfer learning
- **MobileNetV3** — on-device model, exports cleanly to TFLite
- **EfficientNet or ResNet** — heavier server-side confirmation model
- Training data: **PlantVillage + PlantDoc** combined, augmentation weighted toward PlantDoc-style conditions (background clutter, blur, exposure shifts, occlusion) since that's what a real phone camera in a real field produces

## 3. External Integrations

| Integration | Purpose | Notes |
|---|---|---|
| Open-Meteo / IMD | Weather-risk scoring | Open-Meteo as primary (free, no key); IMD if access is obtained |
| Google Earth Engine (Sentinel-2 SR) | NDVI/NDRE satellite data | Free for noncommercial/academic use; register a Google Cloud project |
| ISRO Bhuvan | Sovereign India data source | Worth namechecking for the pitch; raw-band API is more cumbersome than Earth Engine for custom NDVI/NDRE math |
| CROPSAP | Official reporting | Confirmed cases reach scout teams / field experts; framework already active in Maharashtra |
| PMKSK / Krishi Seva Kendra | Regulated input sourcing | Informational routing — nearest regulated retail, fixed prices, no dealer-commission bias |

## 4. Design Principle: False-Alarm Control

Satellite and weather signals alone are **never** sufficient to declare a disease. They only ever trigger a photo request from the farmer — the image diagnosis is the confirmation gate. Healthy tissue despite an elevated risk score is logged as a false alarm and recalibrates the risk-fusion thresholds, rather than reaching the farmer as an alarm. See `PRD.md` Part 2 for the full flow.

## 5. Honest Caveats (say these out loud to judges, don't let them get asked)

- **Satellite thermal resolution/revisit**: Sentinel-2 has no thermal band. Landsat (30m resampled, 16-day/8-day combined revisit) and MODIS (1km, daily) are the only thermal sources, and MODIS is far too coarse for a 1–2 hectare smallholder plot. Thermal therefore contributes more at **district level** within the fusion score than at individual-farm level.
- **Cloud cover**: Maharashtra's monsoon — exactly when fungal/bacterial disease risk peaks — blocks optical/thermal satellite passes for stretches at a time. Satellite signals lag; they are a complement to weather-risk and photo confirmation, not a replacement.
- **NDVI/NDRE lag**: vegetation indices react to chlorophyll/structural change, which happens *after* the very first stomatal closure a true ground thermal sensor would catch. NDRE narrows this gap versus plain NDVI but doesn't close it.
- **Mixed pixels**: very small/fragmented plots (<0.1 ha) may have few pure-crop Sentinel-2 pixels (10–20m); works best aggregated or with farmer-drawn field boundaries.

## 6. Testing Deployment (Vercel)

For early testing/demo purposes, the backend and dashboard deploy to Vercel. This isn't just a hosting choice — it changes three things about how the backend is built:

- **No persistent background workers.** Vercel Functions are stateless and ephemeral, so the Celery + Redis design in §2 doesn't run as-is. Weather polling, satellite polling, and retraining triggers instead run as **Vercel Cron Jobs** — scheduled HTTP calls to a lightweight endpoint that does one unit of work and exits, rather than a long-lived worker process.
- **Execution time limits.** 10s on the free tier, 60s on Pro (longer under Vercel's "Fluid Compute" beta if needed later). Fine for weather/NDVI polling and advisory generation today; worth watching if the server-side confirmation model grows heavier.
- **Stateless, ephemeral filesystem.** Nothing written to local disk persists between invocations — the database and object storage must be external from day one (see Data Layer above), not added later.

**Database:** skip Vercel's own Postgres product — it's deprecated in favor of Marketplace integrations, and extension support there is explicitly restricted, including PostGIS, which this project needs for geo-queries. Use **Supabase** (Postgres with PostGIS enabled by default, generous free tier, also provides object storage in the same place) or a direct **Neon** project with PostGIS turned on.

**What deploys where:**
| Piece | Testing deployment |
|---|---|
| Officer dashboard (React) | Vercel — native fit, no caveats |
| Backend API (FastAPI) | Vercel Functions (ASGI/Python runtime) |
| Scheduled jobs | Vercel Cron Jobs, not Celery/Redis |
| Database | Supabase or Neon (PostGIS enabled) — not Vercel Postgres |
| Object storage | Supabase Storage or Vercel Blob |
| Android app | **Not Vercel** — separate mobile build; debug APK or Firebase App Distribution for test devices |

Practically, this means the FastAPI app needs a thin `api/index.py` entrypoint exposing the ASGI app (Vercel's standard Python convention) plus a `vercel.json`, and each cron job is its own lightweight endpoint under `api/cron/` rather than a Celery task.

## 7. Proposed Repo Structure

```
cropsathi/
├── android/                 # Kotlin app
├── backend/
│   ├── app/
│   │   ├── diagnosis/
│   │   ├── weather_risk/
│   │   ├── ndvi_service/    # see ndvi_service.py reference implementation
│   │   ├── thermal_anomaly/ # see thermal_anomaly.py reference implementation
│   │   ├── risk_fusion/
│   │   ├── advisory/
│   │   └── expert_queue/
│   └── requirements.txt
├── ml/
│   ├── training/             # PyTorch training scripts
│   └── export/                # TFLite export pipeline
├── dashboard/                # React + Leaflet officer dashboard
├── docs/                     # PRD.md, ARCHITECTURE.md, DESIGN.md, PHASES.md
└── infra/                    # Docker Compose, CI config
```
