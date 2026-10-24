# CropSathi — Remote Sensing & Health Scoring Specification

**Status:** Implementation Specification (Audit 2026-10-24 Compliance)  
**Calibration Status:** `literature_seed` (v1.0.0-literature_seed)  
**Governing Code:** `backend/src/services/vegetationHealth.js`, `backend/src/config/vegetationHealth.js`

---

## 1. Fusion Formula & Stress Semantics

The composite crop health score ($H$) synthesizes three independent remote sensing signals into a single scalar on a $[0, 100]$ scale (where $100$ is optimal vegetative vigor and $0$ is maximum physiological stress):

$$H = 100 - \left( w_{\text{ndvi}} \cdot S_{\text{ndvi}} + w_{\text{ndre}} \cdot S_{\text{ndre}} + w_{\text{thermal}} \cdot S_{\text{thermal}} \right) \times 100$$

Where $S_{\text{ndvi}}$, $S_{\text{ndre}}$, and $S_{\text{thermal}}$ represent normalized **stress** components on a $[0, 1]$ interval:
- $S = 0$: No stress (optimal canopy vigor / zero water stress).
- $S = 1$: Maximum stress (severe chlorosis, biomass loss, or severe stomatal closure).

### 1.1 NDVI Stress Component ($S_{\text{ndvi}}$)
Normalized against crop- and growth-stage-specific baseline $[\text{min}_{\text{ndvi}}, \text{max}_{\text{ndvi}}]$:

$$S_{\text{ndvi}} = 1 - \text{clamp}\left( \frac{\text{NDVI} - \text{min}_{\text{ndvi}}}{\text{max}_{\text{ndvi}} - \text{min}_{\text{ndvi}}}, 0, 1 \right)$$

### 1.2 NDRE Stress Component ($S_{\text{ndre}}$)
Normalized against crop- and growth-stage-specific red-edge baseline $[\text{min}_{\text{ndre}}, \text{max}_{\text{ndre}}]$:

$$S_{\text{ndre}} = 1 - \text{clamp}\left( \frac{\text{NDRE} - \text{min}_{\text{ndre}}}{\text{max}_{\text{ndre}} - \text{min}_{\text{ndre}}}, 0, 1 \right)$$

*Physical Note:* Sentinel-2 Band 5 (705 nm) is natively captured at 20 m resolution and resampled to 10 m.

### 1.3 Thermal Stress Component ($S_{\text{thermal}} = \text{CWSI}$)
Crop Water Stress Index based on the Idso / Jackson empirical energy balance model:

$$\text{CWSI} = \text{clamp}\left( \frac{(T_c - T_a) - dT_{\text{lower}}}{dT_{\text{upper}} - dT_{\text{lower}}}, 0, 1 \right)$$

Where:
- $T_c$: Satellite canopy temperature (°C) derived from Landsat 8/9 TIRS.
- $T_a$: Air temperature (°C) from Open-Meteo.
- $dT_{\text{lower}} = a + b \cdot \text{VPD}$: Non-water-stressed baseline (NWSB).
- $dT_{\text{upper}}$: Maximum canopy-air temperature difference at complete stomatal closure.

**Decoupling Policy (TC-07b):** When canopy temperature is formula-estimated (not derived from real Landsat LST), the thermal signal is decoupled: $w_{\text{thermal}} = 0$ and its weight is proportionally redistributed to optical bands.

---

## 2. Growth Stage Scenarios & Weights

Weights vary dynamically by crop stage and drought context to reflect physiological sensitivity:

| Growth Scenario | Crops / Stages | $w_{\text{ndvi}}$ | $w_{\text{ndre}}$ | $w_{\text{thermal}}$ | Max Single Weight |
|---|---|---|---|---|---|
| `early_sparse` | Sowing, Vegetative | **0.40** | **0.35** | **0.25** | 0.40 |
| `balanced` | Flowering, Unknown/Default | **0.35** | **0.40** | **0.25** | 0.40 |
| `late_dense` | Fruiting, Maturity | **0.30** | **0.45** | **0.25** | 0.45 |
| `drought` | High VPD + high temp + dry | **0.30** | **0.30** | **0.40** | 0.40 |
| `harvested` | Harvested stage | *Score = null, no alert* | - | - | - |

### 2.1 Single-Pass Weight Normalization (F-13)
When any signal is missing, stale, or decoupled, weights are renormalized in a single pass across the subset of active usable signals ($\mathcal{A}$):

$$w'_i = \frac{w_i}{\sum_{j \in \mathcal{A}} w_j} \quad \text{for } i \in \mathcal{A}$$

If no signals are usable ($\mathcal{A} = \emptyset$), the score returns `null` (never a default value).

---

## 3. Data Staleness Limits

| Signal | Maximum Usable Age | Fallback Behavior When Stale |
|---|---|---|
| Optical NDVI / NDRE | **10 days** | Marked stale; dropped from active weights or flags reading low-confidence |
| Thermal LST | **5 days** | CWSI skipped; weight redistributed to optical signals |
| Weather (VPD / Temp) | **24 hours** | CWSI skipped; `reason = 'no_weather_data'` |

---

## 4. Multi-Tier Confidence Model (Audit Section 7)

Every score generates an explicit confidence classification:

```
┌────────────────────────────────────────────────────────┐
│ High Confidence                                        │
│ • Sentinel-2 optical data                              │
│ • Scene age < 7 days                                   │
│ • Cloud cover < 20%                                    │
│ • Valid pixel count >= 5                               │
│ • Calibration status = 'calibrated'                    │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Medium Confidence                                      │
│ • Sentinel-2 optical data                              │
│ • Scene age 7–14 days OR cloud cover 20–40%            │
│ • OR capped while calibrationStatus = 'literature_seed'│
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ Low Confidence                                         │
│ • Simulated data (`isSimulated = true`)                │
│ • Scene age > 14 days OR cloud cover > 40%             │
│ • Valid pixel count < 5 (mixed-pixel risk, <1 ha)      │
│ • Uncalibrated / low-confidence dependency             │
│ • INVARIANT: `triggeredAlert` is unconditionally FALSE  │
└────────────────────────────────────────────────────────┘
```

---

## 5. NEEDS_CALIBRATION Constants & Literature Seeds

All parameters marked `NEEDS_CALIBRATION` originate from agricultural literature seeds and require empirical validation against Indian field observations:

| Parameter Key | Current Seed Value | Units / Range | Primary Literature Source | Target Empirical Source |
|---|---|---|---|---|
| `NO_VEGETATION_NDVI` | `0.20` | NDVI [-1, 1] | Rouse et al. (1974) | Indian bare soil / fallow survey |
| `NO_VEGETATION_NDRE` | `0.20` | NDRE [-1, 1] | Barnes et al. (2000) | Early sowing red-edge survey |
| `BASELINE_NDVI_DEFAULT` | `min: 0.0, max: 0.9` | NDVI | Generic optical bounds | ICAR crop-stage spectral database |
| `BASELINE_NDRE_DEFAULT` | `min: -0.1, max: 0.7` | NDRE | Gitelson & Merzlyak (1994) | Sentinel-2 B05 regional calibration |
| `cotton:flowering:ndvi` | `min: 0.35, max: 0.85` | NDVI | Central Institute for Cotton Research (CICR) | Maharashtra field observation CSV |
| `rice:vegetative:ndvi` | `min: 0.25, max: 0.80` | NDVI | IRRI Rice Spectral Library | Punjab/Odisha field observations |
| `wheat:flowering:ndvi` | `min: 0.35, max: 0.85` | NDVI | ICAR-IIWBR Karnal literature | Haryana/MP field observations |
| `CWSI:a (NWSB intercept)`| `1.5` | °C | Idso et al. (1981) | Ground infrared radiometer trials |
| `CWSI:b (NWSB slope)` | `-2.1` | °C / kPa | Idso et al. (1981) | Agro-meteorological stations |
| `CWSI:dT_upper` | `5.0` | °C | Jackson et al. (1988) | Severely water-stressed field trials |
| `ALERT_THRESHOLD_HIGH` | `< 40` | Health score | Audit 2026-10-24 gate | ROC-optimized threshold via backtest |
| `ALERT_THRESHOLD_WATCH`| `60 - 79` | Health score | Audit 2026-10-24 gate | Farmer advisory usability trials |
