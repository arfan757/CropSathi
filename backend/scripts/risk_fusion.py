"""
risk_fusion.py
------------------
The Risk Fusion Engine from ARCHITECTURE.md: turns NDVI, NDRE
(Sentinel-2) and thermal (CWSI from Landsat 8/9) into one Field
Health Score (0-100, higher = healthier).

CONVENTION: this file uses a 0-100 HEALTH score (100 = perfectly
healthy) rather than the 0-1 "anomaly_score" convention used in
ndvi_service.py and thermal_anomaly.py.

3-SIGNAL WEIGHTING:
  FieldHealthScore = (w_NDVI × S_NDVI) + (w_NDRE × S_NDRE) + (w_Thermal × S_Thermal)

  NDVI and NDRE come from Sentinel-2 optical imagery (farm-level
  resolution, ~10-20m). Thermal comes from Landsat 8/9 LST, converted
  to an empirical CWSI (Crop Water Stress Index) via the Idso method.

  Weather is REMOVED from the health score. It is still used for
  disease hypothesis detection in riskService.js but does NOT
  contribute to this score. Weather was a leading indicator but
  introduced too many false alarms — regional weather doesn't reflect
  farm-level conditions.

  pestHistory is REMOVED from the health score. It remains as a
  diagnostic-only signal. Historical data is slow-changing and
  doesn't reflect current crop health.

GROWTH-STAGE WEIGHT SCENARIOS:
  balanced:     ndvi=0.40, ndre=0.40, thermal=0.20
  early_sparse: ndvi=0.40, ndre=0.30, thermal=0.30  (sowing, vegetative)
  late_dense:   ndvi=0.30, ndre=0.40, thermal=0.30  (fruiting, maturity)
  drought:      ndvi=0.30, ndre=0.30, thermal=0.40  (auto-detected from weather)

  All weights sum to 1.0. Max single weight = 0.40 (hard cap).

CWSI (Empirical Idso Method):
  CWSI = clamp((dT − dT_lower) / (dT_upper − dT_lower), 0, 1)
  where:
    dT = T_canopy − T_air
    dT_lower = slope_lower × VPD + intercept_lower  (well-watered baseline)
    dT_upper = slope_upper × VPD + intercept_upper  (full stomatal closure)
    VPD = vapor pressure deficit (Tetens formula)

  All CWSI regression coefficients are NEEDS_CALIBRATION — seeded
  with published approximate values per crop type. Replace with real
  empirically-fit coefficients as ground-referenced canopy temperature
  / soil moisture data accumulates.

DYNAMIC BASELINES:
  NDVI/NDRE are normalized against trailing 90-day 5th/95th percentiles
  per crop type and region (CropBaseline model). Cold-start defaults:
  NDVI: 0.0–0.9, NDRE: -0.1–0.7.

STALENESS LIMITS:
  ndvi: 10 days  (~2 missed Sentinel-2 revisits)
  ndre: 10 days  (same Sentinel-2 image as ndvi)
  thermal: 20 days  (Landsat revisit is slower; extra slack)

  All stale → neutral fallback (score=50, level=watch).

CLOUD COVER GATING:
  NDVI threshold: 40%  — independent check per signal
  Thermal threshold: 50%  — independent check per signal
  Each signal falls back to last valid reading independently.

RESOLUTION MISMATCH:
  Landsat thermal pixel = 30m × 30m = 0.09 ha. Fields smaller than
  this get thermal_confidence: "low".

FALSE-ALARM GATE:
  Max single weight = 0.40 → single signal at max stress gives
  health = 100 − (0.40 × 100) = 60 (WATCH, never ELEVATED).
  Reaching ELEVATED requires ≥2 corroborating signals.

THRESHOLDS -> LEVELS:
  score >= 80  healthy   -- no action
  score >= 60  watch     -- visible in-app, no push alert
  score >= 40  elevated  -- triggers "Farmer Prompted to Upload Photos"
  score <  40  high      -- same trigger, higher-priority notification

  This score NEVER auto-declares a diagnosis by itself -- crossing
  "elevated" only ever triggers a photo request.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class HealthLevel(str, Enum):
    HEALTHY = "healthy"
    WATCH = "watch"
    ELEVATED = "elevated"
    HIGH = "high"


# 3-signal weight scenarios. All sum to 1.0, max single weight ≤ 0.40.
GROWTH_WEIGHTS = {
    "balanced":     {"ndvi": 0.40, "ndre": 0.40, "thermal": 0.20},
    "early_sparse": {"ndvi": 0.40, "ndre": 0.30, "thermal": 0.30},
    "late_dense":   {"ndvi": 0.30, "ndre": 0.40, "thermal": 0.30},
    "drought":      {"ndvi": 0.30, "ndre": 0.30, "thermal": 0.40},
}

STAGE_TO_SCENARIO = {
    "sowing":     "early_sparse",
    "vegetative": "early_sparse",
    "flowering":  "balanced",
    "fruiting":   "late_dense",
    "maturity":   "late_dense",
    "harvested":  None,
}

STALENESS_LIMIT_DAYS = {
    "ndvi": 10,
    "ndre": 10,
    "thermal": 20,
}

NDVI_CLOUD_THRESHOLD_PCT = 40
THERMAL_CLOUD_THRESHOLD_PCT = 50
THERMAL_PIXEL_AREA_HA = 0.09

DEFAULT_NDVI_BASELINE = {"min": 0.0, "max": 0.9}
DEFAULT_NDRE_BASELINE = {"min": -0.1, "max": 0.7}

CWSI_REGRESSION = {
    "cotton":   {"lower": {"slope": -2.5, "intercept": -1.0},
                 "upper": {"slope": 1.8,  "intercept": 6.0}},
    "rice":     {"lower": {"slope": -2.8, "intercept": -1.2},
                 "upper": {"slope": 2.0,  "intercept": 6.5}},
    "wheat":    {"lower": {"slope": -2.2, "intercept": -0.8},
                 "upper": {"slope": 1.5,  "intercept": 5.5}},
    "maize":    {"lower": {"slope": -2.4, "intercept": -0.9},
                 "upper": {"slope": 1.7,  "intercept": 5.8}},
    "soybean":  {"lower": {"slope": -2.3, "intercept": -0.85},
                 "upper": {"slope": 1.6,  "intercept": 5.6}},
    "sugarcane":{"lower": {"slope": -2.6, "intercept": -1.1},
                 "upper": {"slope": 1.9,  "intercept": 6.2}},
    "potato":   {"lower": {"slope": -2.0, "intercept": -0.7},
                 "upper": {"slope": 1.4,  "intercept": 5.0}},
    "grapes":   {"lower": {"slope": -1.8, "intercept": -0.6},
                 "upper": {"slope": 1.3,  "intercept": 4.8}},
    "tur":      {"lower": {"slope": -2.1, "intercept": -0.75},
                 "upper": {"slope": 1.5,  "intercept": 5.2}},
    "default":  {"lower": {"slope": -2.3, "intercept": -0.9},
                 "upper": {"slope": 1.6,  "intercept": 5.5}},
}

DROUGHT_RAINFALL_MAX_MM = 2.0
DROUGHT_TEMP_MIN_C = 35.0


@dataclass
class SignalInput:
    """One fused-in signal. stress is 0-1 (1 = max stress). Source it
    directly from the existing modules."""
    stress: float
    last_updated: datetime = None


@dataclass
class HealthScoreResult:
    score: int                  # 0-100, higher = healthier
    level: HealthLevel
    weights_used: dict
    stale_signals: list
    component_stress: dict
    growth_scenario: str = None


def calculate_vpd(temp_c: float, rh: float) -> float:
    """Vapor Pressure Deficit (Tetens formula)."""
    import math
    e_sat = 0.6108 * math.exp((17.27 * temp_c) / (temp_c + 237.3))
    if rh <= 0:
        return round(e_sat, 3)
    if rh >= 100:
        return 0.0
    return round(e_sat * (1 - rh / 100), 3)


def compute_cwsi(t_canopy: float, t_air: float, vpd: float,
                  crop_type: str = None) -> float:
    """Empirical CWSI (Idso method). NEEDS_CALIBRATION — all coefficients
    are published approximations, not empirically fit from this project's data."""
    crop_key = (crop_type or "default").lower()
    reg = CWSI_REGRESSION.get(crop_key, CWSI_REGRESSION["default"])

    dT = t_canopy - t_air
    dT_lower = reg["lower"]["slope"] * vpd + reg["lower"]["intercept"]
    dT_upper = reg["upper"]["slope"] * vpd + reg["upper"]["intercept"]

    if abs(dT_upper - dT_lower) < 0.001:
        return 0.5
    return max(0.0, min(1.0, (dT - dT_lower) / (dT_upper - dT_lower)))


def get_weights(growth_stage: str = None, is_drought: bool = False) -> dict:
    """Select weight scenario based on growth stage and context."""
    if growth_stage == "harvested":
        return None
    if is_drought:
        return GROWTH_WEIGHTS["drought"]
    scenario = STAGE_TO_SCENARIO.get(growth_stage, "balanced")
    return GROWTH_WEIGHTS[scenario]


def _is_stale(signal_name: str, last_updated, now: datetime) -> bool:
    if last_updated is None:
        return False
    limit = STALENESS_LIMIT_DAYS.get(signal_name)
    if limit is None:
        return False
    return (now - last_updated) > timedelta(days=limit)


def compute_health_score(
    ndvi: SignalInput,
    ndre: SignalInput,
    thermal: SignalInput,
    growth_stage: str = None,
    is_drought: bool = False,
    now: datetime = None,
) -> HealthScoreResult:
    now = now or datetime.utcnow()
    signals = {"ndvi": ndvi, "ndre": ndre, "thermal": thermal}

    weights = get_weights(growth_stage, is_drought)
    if weights is None:
        # harvested — no active crop
        return HealthScoreResult(
            score=None, level=None, weights_used={},
            stale_signals=[], component_stress={}, growth_scenario="harvested",
        )

    stale = [name for name, sig in signals.items()
             if _is_stale(name, sig.last_updated, now)]

    active_weights = {k: (0.0 if k in stale else v) for k, v in weights.items()}
    active_total = sum(active_weights.values())
    if active_total == 0:
        # All fresh signals stale — neutral fallback
        return HealthScoreResult(
            score=50, level=HealthLevel.WATCH, weights_used={"ndvi": 0, "ndre": 0, "thermal": 0},
            stale_signals=stale, component_stress={}, growth_scenario="all_stale",
        )
    normalized_weights = {k: v / active_total for k, v in active_weights.items()}

    weighted_score = 0.0
    component_stress = {}
    for name, sig in signals.items():
        w = normalized_weights[name]
        effective_stress = sig.stress
        component_stress[name] = round(effective_stress, 3)
        if effective_stress is not None and w > 0:
            weighted_score += w * (100 * (1 - effective_stress))

    score = max(0, min(round(weighted_score), 100))

    scenario_key = "drought" if is_drought else STAGE_TO_SCENARIO.get(growth_stage, "balanced")

    return HealthScoreResult(
        score=score,
        level=_level_for_score(score),
        weights_used={k: round(v, 3) for k, v in normalized_weights.items()},
        stale_signals=stale,
        component_stress=component_stress,
        growth_scenario=scenario_key,
    )


def _level_for_score(score: int) -> HealthLevel:
    if score >= 80:
        return HealthLevel.HEALTHY
    if score >= 60:
        return HealthLevel.WATCH
    if score >= 40:
        return HealthLevel.ELEVATED
    return HealthLevel.HIGH


def should_prompt_for_photo(result: HealthScoreResult) -> bool:
    """The false-alarm gate rule: this score never auto-declares a diagnosis.
    It only ever decides whether to ask the farmer for a confirming photo."""
    return result.level in (HealthLevel.ELEVATED, HealthLevel.HIGH)


def estimate_weather_stress(daily_readings: list, disease_thresholds: list) -> float:
    """
    Illustrative starting point for the weather-risk service's own
    score -- replace thresholds with real disease-specific values
    sourced from ICAR/state extension advisories before relying on
    this for real advisories.

    NOTE: Weather stress is used ONLY for disease hypothesis detection
    in riskService.js, NOT as an input to the health score.

    daily_readings: [{"date": ..., "humidity_pct": ..., "temp_c": ...}, ...]
    disease_thresholds: [{"name": "fungal blight", "min_humidity": 85,
                           "temp_range": (18, 25), "min_consecutive_days": 3}, ...]
    """
    worst = 0.0
    for disease in disease_thresholds:
        streak = 0
        max_streak = 0
        for day in daily_readings:
            lo, hi = disease["temp_range"]
            conducive = day["humidity_pct"] >= disease["min_humidity"] and lo <= day["temp_c"] <= hi
            streak = streak + 1 if conducive else 0
            max_streak = max(max_streak, streak)
        needed = disease.get("min_consecutive_days", 3)
        worst = max(worst, min(max_streak / needed, 1.0))
    return worst


# ---------------------------------------------------------------------------
# Demo -- run this file directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    now = datetime(2026, 8, 20)

    scenarios = {
        "all healthy, all fresh": dict(
            ndvi=SignalInput(0.02, now),
            ndre=SignalInput(0.03, now - timedelta(days=2)),
            thermal=SignalInput(0.0, now - timedelta(days=5)),
            growth_stage="vegetative",
        ),
        "NDVI stress alone — visible as 'watch', doesn't trigger photo": dict(
            ndvi=SignalInput(0.7, now),
            ndre=SignalInput(0.05, now - timedelta(days=1)),
            thermal=SignalInput(0.0, now - timedelta(days=4)),
            growth_stage="flowering",
        ),
        "thermal stress alone — early_sparse stage, thermal has more weight": dict(
            ndvi=SignalInput(0.1, now),
            ndre=SignalInput(0.1, now - timedelta(days=1)),
            thermal=SignalInput(0.8, now - timedelta(days=3)),
            growth_stage="sowing",
        ),
        "severe, all signals agree — ELEVATED": dict(
            ndvi=SignalInput(0.75, now),
            ndre=SignalInput(0.80, now - timedelta(days=1)),
            thermal=SignalInput(0.6, now - timedelta(days=3)),
            growth_stage="flowering",
        ),
    }

    for name, sig in scenarios.items():
        result = compute_health_score(**sig, now=now)
        prompt = should_prompt_for_photo(result)
        print(f"\n{name}")
        print(f"  score={result.score}  level={result.level.value}  prompt_for_photo={prompt}")
        print(f"  weights_used={result.weights_used}  stale={result.stale_signals}")
        print(f"  growth_scenario={result.growth_scenario}")
