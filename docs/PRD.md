# CropSathi — Product Requirements Document

**Problem Statement:** SIH26131 — Early detection and management of crop diseases and pest infestations
**Organization:** Government of Maharashtra (Maharashtra State Innovation Society)
**Track:** Software · Theme: Agriculture, FoodTech & Rural Development

---

## 1. Problem Statement

Farmers often recognise crop diseases or pest infestations only after visible damage has spread. Extension staff cover large areas and lab diagnosis isn't immediately available. Weather, crop stage, variety, soil condition, and local pest history all influence risk, but are rarely combined into actionable farm-level alerts — leading to delayed treatment, pesticide misuse, higher cultivation cost, residue concerns, and yield loss.

**Expected solution (official):** a farmer- and extension-worker-friendly crop-health system supporting image-based symptom identification, pest-trap/sensor inputs, weather-based risk forecasting, geospatial hotspot mapping, expert validation, and multilingual advisories — recommending IPM actions, safe input usage, referral to extension/labs, and follow-up monitoring, with dashboards for officials.

## 2. Why This Wins / Competitive Context

This PS scored well on Feasibility/Impact but low on Innovation (5/10) in an early scoring pass — it's a crowded category. Plantix already serves 25M+ farmers globally (7–10M in India) across 780+ disease/pest classes and 30 crops. Out-executing here means building the **full loop**, not just photo classification:

**Detect → Forecast → Map → Manage → Refer → Learn**

**Differentiation vs. Plantix**, for judges:
- State-owned — no dealer-commission bias (unlike Plantix Partner)
- Deeper Maharashtra-specific crop/pest coverage
- Direct CROPSAP integration (surveillance scheme already active in the state)
- Pre-symptomatic risk detection via satellite (NDVI/NDRE + weather fusion), not just reactive photo diagnosis
- Routes farmers to regulated, fixed-price government retail (PMKSK / Krishi Seva Kendra), not commission-driven dealers

## 3. Target Users

| Role | Need |
|---|---|
| **Farmer** | Early warning before visible damage; a clear, affordable, actionable treatment plan; multilingual, low-literacy-friendly UI; works with patchy connectivity |
| **Extension Worker / Expert** | A queue of flagged cases to validate or correct, prioritized by confidence and severity |
| **Agriculture Official (CROPSAP)** | District/taluka-level hotspot visibility to prioritize scout deployment, not just village-by-village manual survey |

## 4. Core Feature Set

1. **Passive Farm Monitoring** — NDVI/NDRE (Sentinel-2), weather-based risk scoring, regional thermal signal, local pest history/soil — fused into a per-farm risk score, with zero farmer effort
2. **Alert & Photo Confirmation** — elevated risk prompts a photo request; nothing is diagnosed from satellite/weather signals alone (false-alarm control)
3. **Two-Tier Image Diagnosis** — on-device offline screening (instant), backend model confirms once online
4. **IPM-First Advisory** — cultural/biological options first; if chemical input is needed, exact dosage, frequency, timing, and pre-harvest safety window
5. **Regulated Sourcing** — nearest PMKSK or Krishi Seva Kendra, not arbitrary dealers
6. **CROPSAP Reporting** — confirmed cases reach scout teams/field experts; area-wide digital pest warnings, not just the reporting farmer
7. **Follow-Up & Resolution Loop** — scheduled re-check, tightened monitoring cadence during an active case, escalation to expert visit if not improving
8. **Officer Dashboard** — geo hotspot map, CROPSAP-style scouting overlay, expert validation queue
9. **Learning Loop** — confirmed outcomes (including false alarms) feed model retraining over time

## 5. Complete User Flow

### Part 1 — Onboarding & Continuous Monitoring
![Onboarding and monitoring flow](flow_A_monitoring.png)

Login → farm boundary/language/crop setup → the system then runs unattended: NDVI/NDRE, weather risk, regional thermal signal, and pest history/soil are continuously fused into a composite farm risk score.

### Part 2 — Alert & False-Alarm Filtering
![Alert and confirmation flow](flow_B_confirmation.png)

**Design principle:** satellite and weather signals never declare a disease by themselves — they only ever trigger a photo request. Ambiguous photos trigger a re-capture request. Healthy tissue despite an elevated score is logged as a false alarm and recalibrates the model rather than alarming the farmer. Only a confident, photo-confirmed result proceeds to an advisory.

### Part 3 — Advisory, Sourcing, Reporting & Resolution
![Advisory to resolution flow](flow_C_resolution.png)

Confirmed diagnosis → IPM-first advisory with dosage/frequency/timing/safety → sourcing at PMKSK/Krishi Seva Kendra + CROPSAP report → follow-up scheduled (7–10 days) → tightened NDVI/thermal monitoring during the active case → resolved (feeds retraining) or escalated (re-photo / extension-worker visit, advisory adjusted).

## 6. Non-Functional Requirements

- **Offline-first**: on-device diagnosis must work with zero connectivity; sync opportunistically
- **Multilingual**: Marathi, Hindi, English at minimum
- **Low digital literacy friendly**: icon-first navigation, large tap targets, minimal required reading (see `DESIGN.md`)
- **Sunlight-readable UI**: high contrast, large type for outdoor use
- **Low false-alarm rate**: the confirmation-gate design in Part 2 is a hard requirement, not a nice-to-have
- **Data sourced from free/public APIs only**: Open-Meteo/IMD, Google Earth Engine (Sentinel-2), no paid satellite contracts

## 7. Success Metrics (for judging & pilot framing)

- Diagnosis accuracy on real-world (non-lab-background) field photos
- Lead time between risk-score alert and visible symptom onset
- False-alarm rate after the photo-confirmation gate
- Time from confirmed case to CROPSAP scout awareness
- Officer dashboard hotspot accuracy vs. actual CROPSAP ground reports

## 8. Constraints & Assumptions

- 1–3 month build runway — real implementation expected for the core loop (see `PHASES.md`), not a mocked demo
- Software track — hardware (ground thermal sensors) stays simulated for this phase; satellite fills that gap at regional resolution
- Small Maharashtra smallholder plots (~1–2 ha) limit satellite resolution/revisit usefulness at farm level for some inputs — see `ARCHITECTURE.md` for caveats

## 9. Out of Scope (v1)

- Custom IoT hardware (ground thermal sensors) — designed for, not built, this phase
- Payment/e-commerce integration with PMKSK/Krishi Seva Kendra (informational routing only)
- Crops/regions outside Maharashtra's priority list
