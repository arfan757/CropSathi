# CropSathi

A smart crop-health intelligence platform for early detection and management of crop stress, disease, and pest risks — built for **SIH26131** (Government of Maharashtra, Software Track).

CropSathi bridges macro-level satellite remote sensing with field-level diagnostic verification. By tracking vegetation indices across farm parcels and validating inputs against physical spectral baselines, the platform flags at-risk zones early, guides farmers toward verified remediation, and gives agricultural officers localized visibility.

---

## Key Capabilities

* **Satellite Field Health Monitoring:** Evaluates multi-spectral optical reflectance within custom user-defined farm polygons to monitor photosynthetic canopy vigor.
* **Surface Validation Guardrails:** Rejects non-agricultural infrastructure (urban rooftops, bare concrete, water bodies) using strict remote-sensing thresholds (NDVI < 0.20).
* **Diagnostic Verification:** Corroborates remote anomaly alerts with leaf-level photo analysis to prevent false alarms before triggering field advisories.
* **Actionable Remediation Pipeline:** Connects field diagnosis to approved input recommendations (Krishi Seva Kendra / PMKSK) and administrative reporting channels.

---

## System Architecture

[ Frontend: Web Dashboard ]
│
├─ Polygon Drawing (Leaflet / Map Interface)
└─ Image Upload & Health Visualizer
│
▼
[ Application Layer ]
│
├─ Coordinate Normalization & Payload Validation
├─ Multi-Spectral Remote Sensing Ingestion Engine
└─ Physical Baseline Gatekeeper (Vegetation Screening)
│
▼
[ Diagnostic & Intelligence Layer ]
│
├─ Scaled Canopy Vigor Normalization (0–100%)
├─ Leaf Pathology Vision Classifier
└─ Geo-referenced Field Records Storage

## Remote Sensing & Health Calculation

### 1. Physical Vegetation Index (NDVI)
Canopy vigor is derived from the difference between Near-Infrared (NIR) reflectance and visible Red absorption:

NDVI = (NIR - Red) / (NIR + Red)

* **Near-Infrared (NIR):** Heavily scattered by healthy spongy mesophyll cell structures in leaves.
* **Visible Red:** Strongly absorbed by leaf chlorophyll for active photosynthesis.

### 2. Built-in Land Classification Validation
Non-vegetative surfaces reflect Red and NIR light nearly symmetrically (NIR ≈ Red):
* **NDVI < 0.20:** Categorized as **Non-Agricultural / Built-up / Bare Rock**. Requests are flagged to prevent false readings over urban infrastructure.
* **NDVI ≥ 0.20:** Validated vegetative land, passed forward to the canopy vigor pipeline.

### 3. Canopy Health Normalization
Accepted readings are mapped via Min-Max linear interpolation against the standard biological canopy saturation point (0.85):

$$\text{Crop Health (\%)} = \text{clamp}\left( \frac{\text{NDVI} - 0.20}{0.85 - 0.20} \times 100, \ 0, \ 100 \right)$$

| Index Range | Status | UI Indicator |
|---|---|---|
| **NDVI < 0.20** | Non-agricultural / Barren Surface | Alert / Rejected |
| **0.20 ≤ NDVI < 0.45** | Sparse / High Vegetative Stress | Watch (Amber) |
| **0.45 ≤ NDVI < 0.65** | Moderate Canopy Coverage | Stable (Yellow-Green) |
| **NDVI ≥ 0.65** | Vigorous / Healthy Canopy | Optimal (Green) |

---

## Tech Stack

* **Frontend:** Interactive Web GIS Dashboard (Leaflet / Map interface, Modern Responsive UI)
* **Backend:** REST API Services (Data ingestion, coordinate transformation, spectral data handling)
* **Remote Sensing Data:** Sentinel-2 multi-spectral optical reflectance integration
* **Computer Vision:** Deep Learning classification models trained on benchmark agricultural pathology datasets
* **Data Layer:** Cloud document / relational storage for farm polygons and diagnostic history

---

## Project Status & Roadmap

* [x] **Phase 1 (Completed):** Interactive polygon field mapping and spatial coordinate capture.
* [x] **Phase 2 (Completed):** Multi-spectral satellite data ingestion with automated non-vegetative surface rejection.
* [x] **Phase 3 (Current MVP):** End-to-end advisory flow from boundary selection to health assessment.
* [ ] **Phase 4 (Next Milestone):** Ingestion of ESA WorldCover 10m LULC raster masks for regional land classification and multi-temporal growth-stage trend tracking.

---

## Team & Presentation

* **Problem Statement:** SIH26131 — Early detection and management of crop diseases and pest infestations.
* **Presentation Date:** September 9, 2026
* **Target Audience:** Farmers, Village Extension Workers, District Agricultural Officers.