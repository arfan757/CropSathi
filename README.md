# CropSathi

A farmer- and extension-worker-friendly crop-health system for early detection and management of crop diseases and pest infestations — built for **SIH26131** (Government of Maharashtra, Software Track).

Continuous passive monitoring (satellite NDVI/NDRE + weather-based risk + regional thermal signal) flags at-risk farms before visible damage, confirms via photo diagnosis to avoid false alarms, then walks the farmer from advisory → regulated input sourcing (PMKSK/Krishi Seva Kendra) → CROPSAP reporting → follow-up, while officials watch it all on a live district hotspot map.

## Docs

| File | What's in it |
|---|---|
| [`PRD.md`](./PRD.md) | Problem statement, differentiation vs. Plantix, full feature set, complete user flow (with diagrams) |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System components, tech stack, external integrations, honest technical caveats, repo layout |
| [`DESIGN.md`](./DESIGN.md) | Visual design system — colors, typography, components (CropSathi brand) |
| [`PHASES.md`](./PHASES.md) | Week-by-week build roadmap for the 1–3 month runway |

## Tech Stack at a Glance

- **Android**: Kotlin, CameraX, TensorFlow Lite, Room, WorkManager
- **Backend**: FastAPI, Celery + Redis
- **Data**: PostgreSQL + PostGIS, S3-compatible object storage
- **ML**: PyTorch → MobileNetV3 (on-device) + EfficientNet/ResNet (server), trained on PlantVillage + PlantDoc
- **Satellite**: Google Earth Engine (Sentinel-2 NDVI/NDRE)
- **Dashboard**: React + Leaflet/Mapbox
- **Weather**: Open-Meteo (IMD as future upgrade)

## Health Score (Risk Fusion)

The dashboard's Field Health gauge is a 0–100 composite (higher = healthier) fused from five 0–1 stress signals (1 = max stress):

| Signal | Source | Staleness limit |
|---|---|---|
| weather | Open-Meteo conditions vs. disease-favorable rules | 2 days |
| ndvi | Sentinel-2 (deficit vs. expected-for-crop/stage, drop vs. 28-day trend, bare-surface floor) | 10 days |
| ndre | Sentinel-2 red-edge — early chlorophyll stress, trend vs. recent readings | 10 days |
| thermal | Landsat 8/9 TOA brightness temperature vs. district/farm baseline | 20 days |
| pestHistory | Confirmed district cases of the same crop, trailing 90 days | never |

**Fusion:** `health = round(100 × (1 − weightedStress))`, clamped to [0, 100], where

```
weightedStress = Σ (weightᵢ × stressᵢ × stageRelevanceᵢ)
              − 0.5 × min(weightedWeather, weightedThermal)
```

- **Per-crop weights** (spec §7.4): default `{weather .35, ndvi .20, ndre .10, thermal .15, pest .20}`; rice shifts weight to vegetation (ndvi .25), cotton/wheat to weather (.40), potato to thermal (.20). NDVI and NDRE share a combined satellite budget so the two correlated vegetation signals are never double-counted.
- **Stage relevance**: each signal is gated by a 0–1 multiplier per crop stage (e.g. NDVI/NDRE less relevant at sowing, weather nearly irrelevant after harvest), so a flowering-only disease never penalizes a vegetative field.
- **Weather–thermal overlap discount**: a heat event drives weather *and* thermal stress simultaneously — summing both would count one underlying cause as two corroborating signals. Half the smaller weighted term is subtracted, and the discount is naturally 0 unless both signals are actually stressed.
- **Staleness**: a signal older than its limit is dropped and its weight redistributes to the fresh signals; if everything is stale, the score falls back to pest-history alone.
- **Levels**: ≥80 healthy · 60–79 watch · 40–59 elevated · <40 high. Elevated/high triggers a photo request — the signals never declare a disease on their own (false-alarm gate).
- **Adaptive threshold**: a per-crop, per-disease stress threshold (base 0.55–0.6) is nudged +0.01 per confirmed false alarm (cap +0.15) and can upgrade watch → elevated, never downgrade a level the fixed bands already flagged.

NDRE is the early-warning channel: it detects chlorophyll loss before NDVI moves in dense canopies, so a falling NDRE alone nudges the score (weight .10) even while NDVI still reads normal.

## Status

Design and architecture phase — see `PHASES.md` for current phase and exit criteria.
