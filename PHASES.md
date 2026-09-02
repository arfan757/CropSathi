# CropSathi — Build Phases

A 1–3 month runway means real implementation is expected, not a mocked demo. Phases are ordered by the priority list in `PRD.md` — each phase should leave the app in a demoable state, since you don't know exactly when you'll need to show progress.

## Phase 0 — Setup (Week 0)
- Repo scaffold (see structure in `ARCHITECTURE.md`)
- Accounts: Google Earth Engine (noncommercial project), Open-Meteo (no key needed), Android project init, Postgres+PostGIS instance
- Download PlantVillage + PlantDoc datasets

**Exit criteria:** empty-but-running Android app + FastAPI backend that can talk to each other; datasets on disk.

## Phase 1 — Core Detection MVP (Weeks 1–3)
- Train MobileNetV3 on PlantVillage + PlantDoc with field-condition augmentation
- Export to TFLite, integrate into Android app with CameraX
- Basic backend diagnosis endpoint (heavier confirmation model)
- Room offline queue + WorkManager sync

**Exit criteria:** a farmer can take a photo offline, get an instant on-device result, and have it sync and get confirmed once online. This is the table-stakes demo — get it solid before anything else.

## Phase 2 — Risk Fusion Layer (Weeks 3–5)
- Weather-risk service (Open-Meteo, rule-based thresholds per disease)
- NDVI/NDRE satellite service (Earth Engine integration, using `ndvi_service.py` as the analysis-logic reference)
- Thermal anomaly service (simulated, using `thermal_anomaly.py` as reference)
- Risk Fusion Engine combining all signals into one composite score

**Exit criteria:** given a farm location, the backend produces a live composite risk score from real weather + real satellite data (thermal can stay simulated).

## Phase 3 — Confirmation Flow + Advisory Engine (Weeks 5–7)
- Alert-triggering logic (elevated score → push notification → guided photo capture)
- False-alarm handling (ambiguous → retry, healthy → logged + recalibrate)
- IPM-first advisory content structure (dosage/frequency/timing/safety), sourced per-disease from ICAR/state extension guidance
- PMKSK / Krishi Seva Kendra location data integration
- CROPSAP reporting integration (or a compatible mock feed if live access isn't available in time)

**Exit criteria:** the full Part 2 + Part 3 flow from `PRD.md` runs end to end for at least one real disease case.

## Phase 4 — Officer Dashboard (Weeks 7–9)
- React + Leaflet dashboard: geo hotspot heatmap, CROPSAP-style scouting overlay
- Expert-validation review queue
- Alert broadcast controls

**Exit criteria:** an official can see confirmed cases populate a live district map as they come in.

## Phase 5 — Follow-Up Loop, Learning, Polish (Weeks 9–11)
- Follow-up scheduling and reminders (7–10 days)
- Tightened monitoring cadence during an active case
- Resolution/escalation logic
- Retraining dataset pipeline from confirmed outcomes (including false alarms)
- Real-world image robustness pressure-testing — this is the #1 way judges expose weak teams, budget real time for it

**Exit criteria:** a case can be walked from alert through to "resolved" or "escalated" live, with the model demonstrably improving from logged outcomes.

## Phase 6 — Pitch & Demo Prep (Final 1–2 Weeks)
- Demo script covering the full loop on a real (or realistically simulated) field case
- Be ready for: "Plantix already does this — what do you do differently?" (see `PRD.md` §2)
- Rehearse the honest caveats in `ARCHITECTURE.md` §5 — judges respect teams that know their own system's limits

**Exit criteria:** a rehearsed, timed demo that survives follow-up questions.

## Dependency Notes
- Phase 2 (risk fusion) and Phase 1 (image diagnosis) can run in parallel with separate team members
- Phase 3 (advisory content) depends on real per-disease dosage data — start sourcing ICAR/state advisory content early, it's slower than it looks
- Phase 4 (dashboard) only needs a trickle of confirmed cases to start, doesn't have to wait for Phase 3 to fully finish
