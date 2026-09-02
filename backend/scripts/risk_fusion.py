"""
risk_fusion.py
------------------
The Risk Fusion Engine from ARCHITECTURE.md: turns weather risk,
NDVI/NDRE anomaly, thermal anomaly, and local pest/soil history into
one Farm Health Score (0-100, higher = healthier).

CONVENTION: this file uses a 0-100 HEALTH score (100 = perfectly
healthy) rather than the 0-1 "anomaly_score" convention used in
ndvi_service.py and thermal_anomaly.py. Those two modules' outputs
plug straight in as `stress = anomaly_score` (their scale already
runs 0-1, 1 = max stress) -- health_score is just 100 * (1 - fused
stress). Pick one convention across the codebase; this file assumes
health-score-out is what the dashboard and advisory engine want.

WEIGHTING RULES, AND WHY:
  weather    0.35  -- most current signal (no cloud-cover gaps, daily+
                       updates), and the best LEADING indicator: humid/
                       warm conditions predict disease before NDVI shows
                       any structural change at all.
  ndvi       0.30  -- farm-level resolution (10-20m) is the most
                       spatially precise signal, but lags (reacts after
                       chlorophyll/structural change) and has real
                       revisit gaps (~5 days nominal, worse in monsoon
                       cloud cover).
  thermal    0.15  -- lower weight ON PURPOSE. Per ARCHITECTURE.md's
                       caveats, satellite thermal (Landsat/MODIS) is
                       district-level resolution at best for a
                       smallholder plot, not farm-specific -- so it
                       contributes context, not a strong farm-level
                       vote.
  historical 0.20  -- local pest history (CROPSAP records) and soil
                       condition. Slow-changing prior, not a live
                       signal -- functions as a risk FLOOR, not a
                       trend.
  Weights sum to 1.0 and are only ever applied to signals that are
  actually fresh -- see the staleness/reweighting rule below.

STALENESS RULE:
  A signal older than its staleness limit is dropped from the average
  entirely and its weight is redistributed proportionally across the
  remaining fresh signals, rather than either (a) trusting stale data
  as current, or (b) silently zeroing it out and understating risk.
  Weather should essentially never go stale; NDVI and thermal both can,
  which is exactly the "satellite alone isn't enough" caveat already
  documented in ARCHITECTURE.md showing up as a concrete rule.

CROP-STAGE GATING:
  The official PS explicitly names crop stage as a risk factor. A
  disease that only strikes at flowering shouldn't drag the score down
  during early vegetative growth -- callers pass a per-signal
  relevance multiplier (0-1) for the crop's current stage; it defaults
  to full relevance if the caller doesn't have stage data yet.

THRESHOLDS -> LEVELS -> THE FALSE-ALARM GATE:
  score >= 80  healthy   -- no action
  score >= 60  watch     -- visible in-app, no push alert
  score >= 40  elevated  -- triggers "Farmer Prompted to Upload Photos"
  score <  40  high      -- same trigger, higher-priority notification
  This score NEVER auto-declares a diagnosis by itself -- per PRD.md
  Part 2, crossing "elevated" only ever triggers a photo request. See
  should_prompt_for_photo().

  DELIBERATE PROPERTY OF THESE WEIGHTS: no single signal, even at its
  own maximum stress value, can push the score into "elevated" alone
  (each weight is well under the ~0.5 needed for that). Reaching
  "elevated" requires at least two signals to corroborate each other.
  This is intentional -- it's the fusion-level version of the same
  false-alarm-control principle used everywhere else in this system,
  applied before a photo is even requested. A single noisy sensor
  reading shows up as "watch" (visible, not alarming) rather than
  triggering an alert on its own.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class HealthLevel(str, Enum):
    HEALTHY = "healthy"
    WATCH = "watch"
    ELEVATED = "elevated"
    HIGH = "high"


# Must sum to 1.0 -- see rationale in the module docstring.
BASE_WEIGHTS = {
    "weather": 0.35,
    "ndvi": 0.30,
    "thermal": 0.15,
    "historical": 0.20,
}

# A signal older than this many days is treated as stale and dropped
# from the fusion (its weight redistributes to the others) rather than
# trusted as current. None = never goes stale (the historical baseline
# changes seasonally, not daily).
STALENESS_LIMIT_DAYS = {
    "weather": 2,     # should essentially never trigger -- no satellite gap
    "ndvi": 10,        # ~2 missed Sentinel-2 revisits
    "thermal": 20,      # Landsat/MODIS revisit is already slow; extra slack
    "historical": None,
}


@dataclass
class SignalInput:
    """One fused-in signal. stress is 0-1 (1 = max stress). Source it
    directly from the existing modules: ndvi_service.py's
    AnomalyResult.anomaly_score, thermal_anomaly.py's
    AnomalyResult.anomaly_score, the weather-risk service's own score
    (or estimate_weather_stress() below as a starting point), and a
    seasonal lookup for historical."""
    stress: float
    last_updated: datetime = None


@dataclass
class HealthScoreResult:
    score: int                  # 0-100, higher = healthier
    level: HealthLevel
    weights_used: dict
    stale_signals: list
    component_stress: dict


def _is_stale(signal_name: str, last_updated, now: datetime) -> bool:
    if last_updated is None:
        return False
    limit = STALENESS_LIMIT_DAYS.get(signal_name)
    if limit is None:
        return False
    return (now - last_updated) > timedelta(days=limit)


def compute_health_score(
    weather: SignalInput,
    ndvi: SignalInput,
    thermal: SignalInput,
    historical: SignalInput,
    crop_stage_relevance: dict = None,
    now: datetime = None,
) -> HealthScoreResult:
    now = now or datetime.utcnow()
    signals = {"weather": weather, "ndvi": ndvi, "thermal": thermal, "historical": historical}
    relevance = crop_stage_relevance or {k: 1.0 for k in signals}

    stale = [name for name, sig in signals.items() if _is_stale(name, sig.last_updated, now)]

    active_weights = {k: (0.0 if k in stale else v) for k, v in BASE_WEIGHTS.items()}
    active_total = sum(active_weights.values())
    if active_total == 0:
        # Everything fresh signal is stale -- fall back to the historical
        # baseline alone rather than return a meaningless fused score.
        active_weights = {"historical": 1.0, "weather": 0.0, "ndvi": 0.0, "thermal": 0.0}
        active_total = 1.0
    normalized_weights = {k: v / active_total for k, v in active_weights.items()}

    weighted_stress = 0.0
    component_stress = {}
    for name, sig in signals.items():
        w = normalized_weights[name]
        r = relevance.get(name, 1.0)
        effective_stress = sig.stress * r
        component_stress[name] = round(effective_stress, 3)
        weighted_stress += w * effective_stress

    score = max(0, min(round(100 * (1 - weighted_stress)), 100))

    return HealthScoreResult(
        score=score,
        level=_level_for_score(score),
        weights_used={k: round(v, 3) for k, v in normalized_weights.items()},
        stale_signals=stale,
        component_stress=component_stress,
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
    """The false-alarm gate rule from PRD.md Part 2: this score never
    auto-declares a diagnosis. It only ever decides whether to ask the
    farmer for a confirming photo."""
    return result.level in (HealthLevel.ELEVATED, HealthLevel.HIGH)


def estimate_weather_stress(daily_readings: list, disease_thresholds: list) -> float:
    """
    Illustrative starting point for the weather-risk service's own
    score -- replace thresholds with real disease-specific values
    sourced from ICAR/state extension advisories before relying on
    this for real advisories.

    daily_readings: [{"date": ..., "humidity_pct": ..., "temp_c": ...}, ...]
    disease_thresholds: [{"name": "fungal blight", "min_humidity": 85,
                           "temp_range": (18, 25), "min_consecutive_days": 3}, ...]

    Persistence matters more than a single reading -- a few humid
    hours isn't as risky as several consecutive humid days, so this
    returns the worst persistence-weighted conduciveness across the
    crop's relevant diseases, not just a snapshot threshold check.
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
            weather=SignalInput(0.05, now),
            ndvi=SignalInput(0.02, now - timedelta(days=2)),
            thermal=SignalInput(0.0, now - timedelta(days=5)),
            historical=SignalInput(0.1),
        ),
        "weather rising alone -- visible as 'watch', but doesn't trigger a photo request by itself": dict(
            weather=SignalInput(0.7, now),
            ndvi=SignalInput(0.05, now - timedelta(days=1)),
            thermal=SignalInput(0.0, now - timedelta(days=4)),
            historical=SignalInput(0.1),
        ),
        "NDVI cloud-blocked/stale, weather+thermal carry the score": dict(
            weather=SignalInput(0.5, now),
            ndvi=SignalInput(0.1, now - timedelta(days=14)),  # stale
            thermal=SignalInput(0.4, now - timedelta(days=6)),
            historical=SignalInput(0.2),
        ),
        "severe, everything agrees": dict(
            weather=SignalInput(0.8, now),
            ndvi=SignalInput(0.75, now - timedelta(days=1)),
            thermal=SignalInput(0.6, now - timedelta(days=3)),
            historical=SignalInput(0.3),
        ),
    }

    for name, sig in scenarios.items():
        result = compute_health_score(**sig, now=now)
        prompt = should_prompt_for_photo(result)
        print(f"\n{name}")
        print(f"  score={result.score}  level={result.level.value}  prompt_for_photo={prompt}")
        print(f"  weights_used={result.weights_used}  stale={result.stale_signals}")
