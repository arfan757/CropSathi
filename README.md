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

## Status

Design and architecture phase — see `PHASES.md` for current phase and exit criteria.
