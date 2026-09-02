# CropSathi — Backend Specification

Companion to `PRD.md`, `ARCHITECTURE.md`, and `DESIGN.md`. This document specifies the FastAPI backend in enough
detail that it can be implemented without further product decisions. It does not cover the Android app or the
React dashboard UI (dashboard *consumes* the API described here).

**Stack:** FastAPI (Python 3.11+), PostgreSQL + PostGIS (Supabase or Neon), SQLAlchemy 2.0 (async) + Alembic,
Pydantic v2, deployed on Vercel Functions with Vercel Cron Jobs replacing Celery/Redis for the testing deployment.
See ARCHITECTURE.md §6 for why.

---

## 1. Repository Layout

```
backend/
├── api/
│   ├── index.py                # ASGI entrypoint Vercel imports (from app.main import app)
│   └── cron/
│       ├── poll_weather.py     # thin handlers, each calls into app/ service code
│       ├── poll_satellite.py
│       ├── retrain_trigger.py
│       └── followup_scan.py
├── app/
│   ├── main.py                 # FastAPI() app, router includes, middleware, CORS
│   ├── config.py                # Pydantic Settings, reads env vars (see §3)
│   ├── db.py                    # async engine/session factory
│   ├── deps.py                  # shared FastAPI dependencies (get_db, get_current_user, require_role)
│   ├── models/                  # SQLAlchemy ORM models, one file per aggregate (see §4)
│   ├── schemas/                 # Pydantic request/response models, mirrors models/
│   ├── routers/                 # one file per API group (see §6)
│   │   ├── auth.py
│   │   ├── farms.py
│   │   ├── monitoring.py
│   │   ├── diagnosis.py
│   │   ├── advisory.py
│   │   ├── sourcing.py
│   │   ├── cropsap.py
│   │   ├── followup.py
│   │   ├── expert_queue.py
│   │   ├── officer_dashboard.py
│   │   └── sync.py
│   ├── diagnosis/                # server-side ensemble inference wrapper
│   ├── weather_risk/              # Open-Meteo/IMD client + risk rules
│   ├── ndvi_service/               # Earth Engine client + anomaly detection
│   ├── thermal_anomaly/             # simulated thermal signal
│   ├── risk_fusion/                  # composite scoring engine
│   ├── advisory/                      # IPM rule engine + i18n content
│   ├── expert_queue/                   # review queue + retraining trigger logic
│   ├── storage/                         # object storage client (Supabase Storage / Vercel Blob)
│   ├── i18n/                             # mr/hi/en string catalogs
│   └── core/
│       ├── security.py                   # JWT issue/verify, password hashing
│       ├── exceptions.py                  # custom exception classes + handlers
│       └── logging.py
├── alembic/
├── tests/
│   ├── unit/
│   ├── integration/
│   └── fixtures/
├── requirements.txt
└── vercel.json
```

**Naming conventions**
- SQLAlchemy models: `PascalCase`, singular (`Farm`, `Diagnosis`).
- Tables: `snake_case`, plural (`farms`, `diagnoses`).
- Pydantic schemas: `<Model>Create`, `<Model>Read`, `<Model>Update` per resource.
- Routers: one `APIRouter()` per business capability, not per table — e.g. `monitoring.py` owns risk score
  endpoints even though it reads from `weather_readings`, `ndvi_readings`, and `thermal_readings` tables.
- All IDs are UUIDv4 (`uuid.uuid4()`), stored as Postgres `uuid` type. Never expose sequential integer IDs.
- All timestamps stored UTC (`timestamptz`), converted to local display only at the client.

---

## 2. Domain Terminology → Code Entities

| Domain term | Table / Model | Notes |
|---|---|---|
| Farmer | `User` (role=`farmer`) | |
| Extension worker / Expert | `User` (role=`expert`) | Reviews the expert queue |
| Agriculture official | `User` (role=`officer`) | Read-only dashboard access + broadcast controls |
| Farm boundary | `Farm` + `farm.boundary` (PostGIS `GEOGRAPHY(Polygon)`) | Farmer-drawn or default point-buffer |
| Composite farm risk score | `RiskScore` | One row per farm per scoring run |
| Photo-confirmation case | `DiagnosisCase` | The unit of work through the whole Detect→Manage loop |
| On-device screening result | `DiagnosisCase.on_device_result` (JSON, synced from app) | Not authoritative |
| Server-side confirmation | `DiagnosisCase.server_result` | Authoritative once present |
| False alarm | `DiagnosisCase.outcome = 'false_alarm'` | Feeds `risk_fusion` recalibration, not shown as alarm to farmer |
| IPM advisory | `Advisory` | Generated once a `DiagnosisCase` is confirmed |
| CROPSAP report | `CropsapReport` | Emitted when a case is confirmed; consumed externally / shown on dashboard |
| Regulated retailer | `SourcingPoint` (PMKSK / Krishi Seva Kendra) | Seeded reference data, geo-indexed |
| Follow-up cycle | `FollowUp` | 7–10 day re-check scheduled off a confirmed case |
| Expert review item | `ExpertReviewItem` | Queue entry, links to a `DiagnosisCase` |
| Retraining signal | `TrainingSample` | Every resolved case (confirmed or false-alarm) becomes one, exported for `ml/training` |

---

## 3. Configuration

All secrets via environment variables (never committed, never in `CLAUDE.md`). Loaded through
`app/config.py` using `pydantic-settings`.

```python
class Settings(BaseSettings):
    database_url: str                     # postgresql+asyncpg://... (Supabase/Neon, PostGIS enabled)
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 30

    object_storage_provider: Literal["supabase", "vercel_blob"] = "supabase"
    supabase_url: str | None = None
    supabase_service_key: str | None = None
    vercel_blob_token: str | None = None

    open_meteo_base_url: str = "https://api.open-meteo.com/v1"
    imd_api_key: str | None = None         # optional fallback, may be unset

    gee_service_account_json: str          # Earth Engine service account credentials (JSON string)
    gee_project_id: str

    server_diagnosis_model_path: str       # path/URI to the EfficientNet/ResNet confirmation model
    tflite_manifest_version: str           # version string synced to app for on-device model parity checks

    cron_secret: str                       # shared secret Vercel Cron must present (see §6.12)

    class Config:
        env_file = ".env"
```

`vercel.json` env vars are set in the Vercel project dashboard for the testing deployment, not committed.

---

## 4. Data Model

PostgreSQL with the `postgis` extension enabled (`CREATE EXTENSION IF NOT EXISTS postgis;`). Alembic migration
0001 enables it before any table creation.

### 4.1 `users`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| phone_number | text unique | Primary login identifier (India: `+91...`) |
| password_hash | text | nullable — OTP-based login is the primary farmer flow (see §6.1) |
| role | enum(`farmer`,`expert`,`officer`,`admin`) | |
| preferred_language | enum(`mr`,`hi`,`en`) | default `mr` |
| full_name | text | |
| district | text | For officers/experts: their assigned jurisdiction |
| taluka | text | nullable |
| created_at, updated_at | timestamptz | |

Index: `phone_number` unique; `(role, district)` for expert/officer routing.

### 4.2 `farms`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| owner_id | uuid fk → users.id | |
| name | text | farmer-given label, optional |
| boundary | geography(Polygon, 4326) | farmer-drawn in app; nullable until drawn |
| centroid | geography(Point, 4326) | derived, always present (used when boundary absent, per ARCHITECTURE.md §5 mixed-pixel caveat — plots <0.1ha fall back to point + fixed buffer) |
| area_hectares | numeric | derived from boundary, or farmer-entered estimate if no boundary |
| district | text | derived via reverse geocode at creation |
| taluka | text | |
| primary_crop | text fk → crop_catalog.code | |
| crop_stage | enum(`sowing`,`vegetative`,`flowering`,`fruiting`,`maturity`,`harvested`) | updated by farmer or inferred from sowing_date + crop calendar |
| sowing_date | date | nullable |
| soil_type | text | nullable, farmer-entered or district default |
| created_at, updated_at | timestamptz | |

Index: GIST index on `boundary` and `centroid` for geo queries.

### 4.3 `crop_catalog`

Reference table, seeded, not user-editable via API.

| Column | Type | Notes |
|---|---|---|
| code | text pk | e.g. `cotton`, `soybean`, `tur` |
| name_en, name_hi, name_mr | text | |
| typical_sowing_window | daterange (month/day only, repeats yearly) | used for crop-stage inference |
| priority_maharashtra | boolean | whether in scope per PRD §9 (out-of-scope crops rejected at farm creation) |

### 4.4 `disease_catalog`

| Column | Type | Notes |
|---|---|---|
| code | text pk | model class label, must match both TFLite and server model output |
| name_en, name_hi, name_mr | text | |
| crop_code | text fk → crop_catalog.code | |
| pathogen_type | enum(`fungal`,`bacterial`,`viral`,`pest`,`nutrient_deficiency`,`abiotic`) | |
| severity_scale | enum(`low`,`medium`,`high`,`critical`) options only; not free numeric — mapped from model confidence bands defined in `advisory` service |

### 4.5 `weather_readings`

One row per farm per polling run (cron-driven, §6.12).

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| farm_id | uuid fk | |
| source | enum(`open_meteo`,`imd`) | |
| observed_at | timestamptz | |
| temperature_c, humidity_pct, rainfall_mm_24h | numeric | |
| raw_payload | jsonb | full upstream response, kept for debugging/audit, not returned by API by default |
| created_at | timestamptz | |

Index: `(farm_id, observed_at desc)`.

### 4.6 `ndvi_readings`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| farm_id | uuid fk | |
| observed_at | timestamptz | satellite pass date |
| ndvi | numeric | |
| ndre | numeric | |
| cloud_cover_pct | numeric | reading discarded downstream (not deleted) if above threshold — see §7.2 |
| trailing_avg_ndvi_28d | numeric | precomputed at write time |
| anomaly_score | numeric | (current − trailing_avg) / stddev, precomputed |
| pixel_count_pure_crop | integer | mixed-pixel diagnostic per ARCHITECTURE.md §5; low counts flagged |
| created_at | timestamptz | |

### 4.7 `thermal_readings`

Simulated per ARCHITECTURE.md §2 ("currently simulated — weather-adjusted leaf-temperature baseline").

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| farm_id | uuid fk | |
| observed_at | timestamptz | |
| estimated_canopy_temp_c | numeric | derived: air temp + crop-specific offset − humidity adjustment (documented formula in `thermal_anomaly/README.md`, not a real sensor read) |
| baseline_temp_c | numeric | rolling district-level baseline (MODIS-informed at district granularity per ARCHITECTURE.md §5) |
| anomaly_c | numeric | estimated − baseline |
| resolution | enum(`district`,`farm_simulated`) | always `farm_simulated` today; column exists so a future real-sensor source can slot in without a schema change |
| created_at | timestamptz | |

### 4.8 `risk_scores`

The Risk Fusion Engine's output — one row per farm per scoring run.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| farm_id | uuid fk | |
| computed_at | timestamptz | |
| weather_component | numeric (0–1) | |
| ndvi_component | numeric (0–1) | |
| thermal_component | numeric (0–1) | |
| pest_history_component | numeric (0–1) | derived from historical `diagnosis_cases` in the district |
| composite_score | numeric (0–1) | weighted fusion, see §7.4 |
| triggered_alert | boolean | true if composite_score crossed the crop-specific threshold |
| disease_hypothesis | text fk → disease_catalog.code, nullable | best-guess class driving the alert, shown in the photo-request prompt copy only, never surfaced as a diagnosis |
| inputs_snapshot | jsonb | the specific weather/ndvi/thermal reading IDs used, for audit/explainability |

Index: `(farm_id, computed_at desc)`.

### 4.9 `diagnosis_cases`

The central object of the Detect→Forecast→Map→Manage→Refer→Learn loop.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| farm_id | uuid fk | |
| triggered_by | enum(`risk_alert`,`farmer_initiated`) | farmer can also open the scan proactively, not only when prompted |
| triggering_risk_score_id | uuid fk → risk_scores.id, nullable | |
| status | enum(`awaiting_photo`,`awaiting_sync`,`on_device_screened`,`pending_server_confirmation`,`confirmed`,`false_alarm`,`ambiguous_recapture_requested`,`escalated`,`resolved`) | state machine, see §8 |
| on_device_result | jsonb | `{disease_code, confidence, model_version}` synced from app |
| server_result | jsonb | `{disease_code, confidence, model_version, severity}` — authoritative |
| final_disease_code | text fk → disease_catalog.code, nullable | set on confirmation |
| final_severity | enum(`low`,`medium`,`high`,`critical`), nullable | |
| confidence | numeric, nullable | server model confidence for final_disease_code |
| outcome | enum(`confirmed_treated`,`false_alarm`,`escalated_unresolved`), nullable | set at resolution, feeds §7.7 |
| requires_expert_review | boolean default false | set true when confidence below threshold (§7.5) |
| gps_point | geography(Point, 4326) | photo capture location, may differ slightly from farm centroid |
| captured_at | timestamptz | when the farmer took the photo, per device clock |
| synced_at | timestamptz, nullable | when it reached the backend |
| created_at, updated_at | timestamptz | |

Index: `(farm_id, status)`, `(status, requires_expert_review)`, GIST on `gps_point` for hotspot mapping.

### 4.10 `case_photos`

A case can have multiple photos (original + recapture requests).

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk | |
| storage_key | text | object storage path, see §10 |
| is_recapture | boolean | |
| leaf_segmentation_applied | boolean | whether on-device cropping ran before upload |
| uploaded_at | timestamptz | |

### 4.11 `advisories`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk unique | one advisory per case, regenerated (versioned) on escalation |
| version | integer default 1 | incremented if advisory is adjusted after escalation (PRD §5 Part 3) |
| ipm_cultural_actions | jsonb | array of `{action_key, language_variants: {mr,hi,en}}` |
| ipm_biological_actions | jsonb | same shape, cultural/biological offered first per PRD §4 |
| chemical_recommendation | jsonb, nullable | `{product_class, dosage, unit, frequency, application_timing, pre_harvest_interval_days}` — only populated if cultural/biological insufficient for severity |
| generated_at | timestamptz | |

**Hard rule:** `chemical_recommendation` is never generated without `pre_harvest_interval_days` populated — the
advisory service must reject/refuse to persist a chemical recommendation missing that field (PRD §4, §6 safety
requirement).

### 4.12 `sourcing_points`

Reference data, seeded from government PMKSK/KSK registries, refreshed periodically (manual import job, not a
farmer-facing write).

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| name | text | |
| type | enum(`pmksk`,`krishi_seva_kendra`) | |
| location | geography(Point, 4326) | |
| district, taluka | text | |
| contact_phone | text, nullable | |
| active | boolean default true | |

Index: GIST on `location` for nearest-point queries.

### 4.13 `cropsap_reports`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk unique | |
| district, taluka | text | denormalized from farm for fast dashboard aggregation |
| disease_code | text | |
| severity | text | |
| reported_at | timestamptz | |
| broadcast_radius_km | numeric, nullable | if an officer triggers an area-wide warning off this report (PRD §4 item 6) |
| broadcast_sent_at | timestamptz, nullable | |

### 4.14 `follow_ups`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk | |
| scheduled_for | date | captured_at + 7 to 10 days per crop-disease pair (configurable, not hardcoded to a single number) |
| status | enum(`pending`,`completed_improved`,`completed_unimproved`,`missed`) | |
| tightened_monitoring_until | date, nullable | during an active case, NDVI/thermal polling cadence increases (§7.4 notes) |
| completed_at | timestamptz, nullable | |
| notes | text, nullable | farmer or expert notes at follow-up |

### 4.15 `expert_review_items`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk unique | |
| assigned_expert_id | uuid fk → users.id, nullable | |
| priority | enum(`low`,`medium`,`high`) | derived from confidence gap + risk score at trigger time |
| status | enum(`pending`,`in_review`,`resolved`) | |
| expert_verdict | text fk → disease_catalog.code, nullable | |
| expert_notes | text, nullable | |
| resolved_at | timestamptz, nullable | |

### 4.16 `training_samples`

Feeds `ml/training` export, not served over the public API except to an admin export endpoint.

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| case_id | uuid fk | |
| photo_storage_key | text | |
| label | text | final_disease_code, or `healthy` for false alarms |
| label_source | enum(`server_model_confirmed`,`expert_confirmed`) | |
| exported | boolean default false | |
| created_at | timestamptz | |

### 4.17 `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| user_id | uuid fk | |
| token_hash | text | |
| expires_at | timestamptz | |
| revoked | boolean default false | |

---

## 5. Authentication & Authorization

- **Farmer & expert login:** phone number + OTP (OTP delivery is out of backend scope for v1 — stub an OTP
  provider interface in `app/core/security.py` with a console/log-based fake provider for testing deployment;
  real SMS gateway is a follow-up integration, not blocking the spec).
- **Officer/admin login:** phone + OTP as well, no separate password flow, to keep one auth path.
- Successful OTP verification issues a short-lived JWT access token (`access_token_ttl_minutes`) and a longer-lived
  opaque refresh token stored hashed in `refresh_tokens`.
- `app/deps.py::get_current_user` decodes the JWT, loads the `User`, attaches to `request.state`.
- `app/deps.py::require_role(*roles)` is a dependency factory used per-router, e.g.
  `require_role("officer", "admin")` on all `officer_dashboard.py` routes.
- Farmers can only read/write resources where `farm.owner_id == current_user.id`. Enforce this at the query
  level (filter by owner), not just at the response level — never fetch-then-authorize.
- Experts see `expert_review_items` filtered to their `district`/`taluka` unless `assigned_expert_id` is
  explicitly them.
- Cron endpoints (§6.12) are not user-authenticated; they require the `X-Cron-Secret` header matching
  `settings.cron_secret`, set by Vercel Cron's configured header.

---

## 6. API Reference

Base path: `/api/v1`. All responses JSON. All list endpoints paginated via `?limit=&cursor=` (cursor = last row's
`id`, since `created_at` isn't strictly monotonic-unique enough for stable pagination at scale). Error shape in
§12.

### 6.1 Auth — `routers/auth.py`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/otp/request` | none | `{phone_number}` → triggers OTP send (stubbed) |
| POST | `/auth/otp/verify` | none | `{phone_number, otp_code}` → `{access_token, refresh_token, user}` |
| POST | `/auth/refresh` | none (refresh token in body) | `{refresh_token}` → new access token |
| POST | `/auth/logout` | bearer | revokes the refresh token |
| GET | `/auth/me` | bearer | current user profile |
| PATCH | `/auth/me` | bearer | update `preferred_language`, `full_name` |

### 6.2 Farms — `routers/farms.py` (role: farmer for writes; farmer/expert/officer for reads scoped as in §5)

| Method | Path | Description |
|---|---|---|
| POST | `/farms` | Create farm. Body: `{name?, boundary_geojson?, centroid: {lat, lng}, primary_crop, sowing_date?, soil_type?}`. Rejects `primary_crop` not in `crop_catalog.priority_maharashtra=true` (PRD §9). |
| GET | `/farms` | List current farmer's farms |
| GET | `/farms/{farm_id}` | Detail, includes latest `risk_scores` row inline |
| PATCH | `/farms/{farm_id}` | Update boundary, crop_stage, sowing_date |
| DELETE | `/farms/{farm_id}` | Soft delete (adds `deleted_at`, excluded from cron polling) |

### 6.3 Monitoring / Risk — `routers/monitoring.py`

| Method | Path | Description |
|---|---|---|
| GET | `/farms/{farm_id}/risk-history` | Paginated `risk_scores` rows, for the app's trend view |
| GET | `/farms/{farm_id}/risk-latest` | Latest composite score + component breakdown |
| GET | `/farms/{farm_id}/weather` | Recent `weather_readings` |
| GET | `/farms/{farm_id}/ndvi` | Recent `ndvi_readings` |

Farmers never see a raw "disease" from this router — only the composite score and, if `triggered_alert`, a
prompt-to-photograph message. `disease_hypothesis` is included in the response payload but the app is expected
(per DESIGN.md/PRD.md) to render it only as generic "elevated risk detected — scan your crop," never as a
diagnosis. This is a UI convention the backend cannot enforce, so the field is documented as internal/advisory-only
in the OpenAPI schema description.

### 6.4 Diagnosis — `routers/diagnosis.py`

| Method | Path | Description |
|---|---|---|
| POST | `/cases` | Create a `diagnosis_case`. Body: `{farm_id, triggered_by, triggering_risk_score_id?, gps_point, captured_at}`. Returns case with `status='awaiting_photo'` (or `awaiting_sync` if created during offline sync, see §6.11) |
| POST | `/cases/{case_id}/photos` | Multipart upload. Stores via object storage (§10), creates `case_photos` row, if this is the case's first photo and `on_device_result` already present in the request body, advances status to `pending_server_confirmation` and enqueues server inference |
| GET | `/cases/{case_id}` | Full case detail: photos, on_device_result, server_result, advisory (if present), follow_up (if present) |
| GET | `/farms/{farm_id}/cases` | List cases for a farm |
| POST | `/cases/{case_id}/recapture` | Marks case `ambiguous_recapture_requested`, farmer's next photo upload attaches with `is_recapture=true` |

**Server confirmation flow** (triggered internally after photo upload, not a separate endpoint the client calls):
1. Load photo, run through server ensemble model (`app/diagnosis/`).
2. Compare against `on_device_result` — if they agree and confidence ≥ `CONFIDENCE_CONFIRM_THRESHOLD` (config,
   default 0.85), set `status='confirmed'`, populate `final_disease_code`, `final_severity`, `confidence`.
3. If confidence is below threshold, or the case's photo shows healthy tissue despite an elevated triggering
   risk score, set `status='false_alarm'` and `outcome='false_alarm'` — **do not** notify this as an alert to the
   farmer; log a `training_samples` row with `label='healthy'`.
4. If image quality/confidence is ambiguous (neither clearly healthy nor clearly diagnosable, e.g. confidence in
   a middle band, default 0.4–0.85), set `status='ambiguous_recapture_requested'`.
5. If confirmed but `confidence < EXPERT_REVIEW_THRESHOLD` (config, default 0.7) or `final_severity in
   ('high','critical')`, set `requires_expert_review=true` and create an `expert_review_items` row.
6. On `status='confirmed'`: synchronously trigger advisory generation (§6.5), CROPSAP report creation (§6.7), and
   follow-up scheduling (§6.8) within the same request/transaction — these are cheap deterministic operations, not
   separate background jobs, so the client's confirmation response can include everything at once.

### 6.5 Advisory — `routers/advisory.py`

| Method | Path | Description |
|---|---|---|
| GET | `/cases/{case_id}/advisory` | Latest advisory version, localized to `current_user.preferred_language` |
| POST | `/cases/{case_id}/advisory/regenerate` | expert/officer only — regenerates after escalation, increments `version` |

Advisory generation itself (`app/advisory/`) is a rule engine keyed on `(disease_code, severity, crop_stage)`,
not a model call — see §7.6.

### 6.6 Sourcing — `routers/sourcing.py`

| Method | Path | Description |
|---|---|---|
| GET | `/sourcing/nearby?lat=&lng=&radius_km=` | Nearest active `sourcing_points`, PostGIS `ST_DWithin` + `ST_Distance` ordering, default radius 15km, expands to 30km if none found |

Informational only per PRD §9 — no ordering/payment fields exist on `sourcing_points` by design.

### 6.7 CROPSAP — `routers/cropsap.py`

| Method | Path | Description |
|---|---|---|
| GET | `/cropsap/reports?district=&taluka=&since=` | officer/expert — list reports |
| POST | `/cropsap/reports/{report_id}/broadcast` | officer only — `{radius_km}`, sets `broadcast_radius_km`/`broadcast_sent_at`, and (internally) creates informational `diagnosis_cases`-adjacent notices for farms within radius. Notice delivery mechanism (push notification) is outside this spec's scope; this endpoint's job is to persist the broadcast intent and expose it via a `GET /farms/{farm_id}/notices` endpoint the app polls. |

Report creation itself is automatic on case confirmation (§6.4 step 6), not a manual POST.

### 6.8 Follow-up — `routers/followup.py`

| Method | Path | Description |
|---|---|---|
| GET | `/cases/{case_id}/followup` | Current follow-up status |
| POST | `/cases/{case_id}/followup/complete` | Body: `{improved: bool, notes?}`. If `improved=true` → `status='completed_improved'`, case `status='resolved'`, `outcome='confirmed_treated'`, creates `training_samples` row (`label_source='server_model_confirmed'`). If `improved=false` → `status='completed_unimproved'`, case `status='escalated'`, creates an `expert_review_items` row if not already present, and prompts a recapture (client calls `/cases/{case_id}/recapture` next). |

Follow-up creation is automatic on confirmation (§6.4 step 6); there is no manual "create follow-up" endpoint.

### 6.9 Expert Queue — `routers/expert_queue.py` (role: expert, officer)

| Method | Path | Description |
|---|---|---|
| GET | `/expert-queue?status=&priority=&district=` | List, defaults to current expert's district, ordered by priority desc then created_at asc |
| POST | `/expert-queue/{item_id}/claim` | Sets `assigned_expert_id=current_user.id`, `status='in_review'` |
| POST | `/expert-queue/{item_id}/resolve` | Body: `{verdict_disease_code, notes?}`. Updates the linked case's `final_disease_code`/`final_severity` if the expert overrides the model, sets item `status='resolved'`, creates a `training_samples` row with `label_source='expert_confirmed'` (expert labels take precedence over model labels for retraining) |

### 6.10 Officer Dashboard — `routers/officer_dashboard.py` (role: officer, admin)

| Method | Path | Description |
|---|---|---|
| GET | `/dashboard/hotspots?district=&taluka=&since=&disease_code=` | Aggregated case counts by `taluka` (or a grid cell if finer resolution requested), for heatmap rendering. Returns `[{taluka, lat, lng, confirmed_case_count, false_alarm_count, dominant_disease_code}]` |
| GET | `/dashboard/trends?district=&disease_code=&granularity=week` | Time series of confirmed case counts, for trend charts |
| GET | `/dashboard/scouting-overlay?district=` | Merges `risk_scores.triggered_alert=true` farms not yet photo-confirmed with confirmed `diagnosis_cases`, for the CROPSAP-style scouting priority view described in PRD §4 item 8 |
| GET | `/dashboard/expert-queue-summary?district=` | Counts by status/priority, for the officer's queue-health widget |

### 6.11 Offline Sync — `routers/sync.py`

The Android app's Room DB queues everything locally with a `synced` flag (ARCHITECTURE.md §2) and pushes via
WorkManager. This is a batch endpoint, not a per-record replay of §6.2–6.8's individual endpoints, to minimize
round trips on patchy connectivity.

| Method | Path | Description |
|---|---|---|
| POST | `/sync/batch` | Body: `{device_id, batch: [{client_local_id, type: 'case_created'|'photo_uploaded'|'followup_completed', payload, occurred_at}]}`. Processes each item idempotently (see below), returns `{results: [{client_local_id, server_id, status: 'applied'|'duplicate'|'error', error?}]}` |

**Idempotency:** every sync item carries a client-generated `client_local_id` (UUID generated on-device at
creation time). The backend stores `(device_id, client_local_id)` as a unique constraint on a lightweight
`sync_log` table; replays of the same item return the previously-produced `server_id` with `status='duplicate'`
rather than creating a second record. This is required because WorkManager retries are expected on flaky rural
connectivity.

**Conflict resolution:** last-write-wins is not acceptable for diagnosis cases (would let a stale retry overwrite
a server-confirmed result with an older local status). Rule: sync items only ever *create* new cases/photos or
*append* follow-up completions — they never overwrite a case whose server-side `status` has already progressed
past what the client's local record implies. If a sync item's implied status is behind the server's actual
status, the response includes the current server state so the app can reconcile its local Room row, rather than
erroring.

### 6.12 Cron Endpoints — `api/cron/*.py`

Each is a thin FastAPI-independent handler (or a minimal FastAPI sub-app) doing one unit of work and returning,
per ARCHITECTURE.md §6 execution-time limits. All require `X-Cron-Secret` header.

| Path | Schedule (vercel.json) | Does |
|---|---|---|
| `/api/cron/poll_weather` | every 6 hours | For each active farm not polled in the last interval, fetch Open-Meteo (fallback IMD), write `weather_readings`, recompute `risk_scores` for that farm |
| `/api/cron/poll_satellite` | daily | Batches farms by Sentinel-2 tile to minimize Earth Engine calls; for farms with a case in `tightened_monitoring_until` window, poll more frequently (still daily cap — Sentinel-2 revisit is ~5 days, so this is "poll for new passes daily" not "force new passes") |
| `/api/cron/followup_scan` | daily | Finds `follow_ups` where `scheduled_for <= today` and `status='pending'`, sends a push-notification trigger (delivery mechanism out of scope, see §6.7) prompting the farmer to complete follow-up in-app |
| `/api/cron/retrain_trigger` | weekly | Counts un-exported `training_samples`; if above threshold (config, default 500), marks a batch `exported=true` and writes a manifest file to object storage for `ml/training` to pick up. Does not run training itself (out of scope for a Vercel Function — training happens offline in `ml/`) |

Given Vercel's 10s/60s limits, `poll_weather` and `poll_satellite` must process farms in bounded chunks per
invocation (config `CRON_BATCH_SIZE`, default 200) and rely on invocation frequency, not single-run completeness,
to eventually cover all farms — track a `last_polled_at` per farm and always process the oldest first.

---

## 7. Service Internals

### 7.1 Weather-Risk Service (`app/weather_risk/`)

- Client wraps Open-Meteo (no key required); falls back to IMD if `imd_api_key` set and Open-Meteo errors.
- Rule-based scoring, not ML: a lookup table per `(crop_code, disease_code)` defines humidity/temperature/rainfall
  threshold bands (e.g. late blight risk rises sharply above 80% humidity + 15–20°C for >48h). Table seeded as
  static JSON in `app/weather_risk/rules/`, versioned like the disease catalog, editable without a code deploy
  (loaded at startup, cached).
- Output: `weather_component` in [0,1], plus which rule(s) fired (used for `disease_hypothesis` in §4.8).

### 7.2 NDVI/NDRE Satellite Service (`app/ndvi_service/`)

- Google Earth Engine Python client, authenticated via service-account JSON (`gee_service_account_json`).
- Per farm: query Sentinel-2 SR imagery clipped to `boundary` (or a buffered circle around `centroid` if no
  boundary — buffer radius sized so small plots still get *some* pixels per ARCHITECTURE.md §5's mixed-pixel
  caveat, default 40m).
- Discard scenes with `cloud_cover_pct` above a configurable threshold (default 40%) rather than writing a
  low-quality reading — monsoon gaps are expected and the fusion engine (§7.4) must tolerate missing recent NDVI,
  not treat a gap as "no risk."
- Compute trailing 28-day average and anomaly score as in §4.6.
- `ndvi_component` in [0,1]: derived from how far anomaly_score deviates below the trailing average, floored at 0
  when NDVI is at/above baseline (an *improving* NDVI shouldn't contribute risk).

### 7.3 Thermal Anomaly Service (`app/thermal_anomaly/`)

- No real sensor exists yet (ARCHITECTURE.md §2, §5). Implementation is a documented formula, not a stub that
  returns zero — it must produce a genuinely weather-derived estimate so the fusion score is meaningful today and
  the column/interface is ready to swap in MODIS-informed district baselines or real ground sensors later without
  a schema change (see `resolution` column, §4.7).
- Formula (documented in code, not hidden): `estimated_canopy_temp_c = air_temp_c + crop_offset_c -
  (humidity_pct - 50) * humidity_coefficient`, where `crop_offset_c` and `humidity_coefficient` are per-crop
  constants in `app/thermal_anomaly/constants.py`.
- `baseline_temp_c` computed as a rolling district average of `estimated_canopy_temp_c` over the trailing 14 days
  across all farms in the district (this is the "district-level, not farm-level" resolution called out in
  ARCHITECTURE.md §5).
- `thermal_component` in [0,1]: scaled from `anomaly_c`.

### 7.4 Risk Fusion Engine (`app/risk_fusion/`)

Composite score is a weighted sum, weights configurable per crop (some crops lean more on weather rules, others
on NDVI trend), default weights:

```
composite_score = 0.35 * weather_component
                 + 0.30 * ndvi_component
                 + 0.15 * thermal_component
                 + 0.20 * pest_history_component
```

- `pest_history_component`: fraction of confirmed (non-false-alarm) `diagnosis_cases` for the same
  `(district, crop_code)` in the trailing 90 days, normalized against a district baseline rate.
- Alert threshold per `(crop_code, disease_hypothesis)`, default 0.6, configurable — crossing it sets
  `triggered_alert=true` and (via `monitoring.py`'s internal call, not a separate cron) creates a
  `diagnosis_case` with `triggered_by='risk_alert'` and `status='awaiting_photo'`, which is what surfaces the
  photo-request prompt in the app.
- **False-alarm recalibration** (ARCHITECTURE.md §4): when a case resolves `outcome='false_alarm'`, the
  fusion engine nudges that `(crop_code, disease_hypothesis)` threshold upward slightly (config-bounded max
  adjustment per event, e.g. +0.01, capped at +0.15 cumulative drift before requiring manual review) — implemented
  as a scheduled recompute (part of `retrain_trigger` cron, §6.12), not applied instantly per false alarm, to
  avoid threshold thrashing from a single noisy case.
- **Tightened monitoring**: while a case is active (`status` not in `resolved`/`false_alarm`), that farm's
  `follow_ups.tightened_monitoring_until` gates `poll_satellite`/`poll_weather` to prioritize it in each cron
  batch (§6.12) ahead of farms with no active case.

### 7.5 Diagnosis Service (`app/diagnosis/`)

- Wraps the server-side confirmation model (EfficientNet or ResNet, per ARCHITECTURE.md §2), loaded once at
  cold start from `server_diagnosis_model_path`, kept warm across invocations where Vercel's runtime allows
  (falls back to lazy load per-invocation if not — acceptable given advisory generation isn't real-time-critical
  the way the on-device model is).
- Input: the uploaded photo (post on-device leaf segmentation if the app applied it — `case_photos.leaf_segmentation_applied` flag tells the service whether to also run its own crop/segment step server-side for images that arrived unsegmented).
- Output: `{disease_code, confidence, severity}` — severity derived from a combination of model confidence band
  and a lesion-coverage heuristic (fraction of segmented leaf area flagged), not confidence alone, since a
  high-confidence-but-small-lesion case shouldn't be scored `critical`.
- Confidence thresholds (`CONFIDENCE_CONFIRM_THRESHOLD`, `EXPERT_REVIEW_THRESHOLD`) are settings, not constants,
  so they can be tuned post-launch without a redeploy of model code.

### 7.6 Advisory / IPM Engine (`app/advisory/`)

- Deterministic rule table keyed `(disease_code, severity, crop_stage)` → ordered action list, seeded as
  versioned JSON (same pattern as §7.1's weather rules) so agronomists can update recommendations without a code
  change.
- Always returns cultural actions; returns biological actions if defined for that disease; only returns
  `chemical_recommendation` if the rule table marks that `(disease_code, severity)` combination as requiring it —
  cultural/biological-sufficient cases simply have `chemical_recommendation: null`.
- Every string surfaced to a farmer exists in `mr`/`hi`/`en` in the rule table; if a translation is missing for
  the farmer's `preferred_language`, service falls back to `en` and logs a warning — it must never fall back
  silently in a way that could mask a missing safety instruction (fail loud in logs, not to the user).

### 7.7 Expert Queue & Retraining Loop (`app/expert_queue/`)

- `priority` on creation: `high` if `final_severity in ('high','critical')` or confidence in the bottom quartile
  of `EXPERT_REVIEW_THRESHOLD`; `medium` if only one of those; else `low`.
- Retraining export (triggered by `retrain_trigger` cron, §6.12) writes a manifest referencing
  `training_samples.photo_storage_key` + `label`, doesn't move or duplicate the photo files — `ml/training`
  reads directly from the same object storage bucket.

---

## 8. `diagnosis_cases.status` State Machine

```
awaiting_photo ──(app offline capture)──> awaiting_sync ──(sync/batch)──> on_device_screened
on_device_screened ──(photo upload w/ connectivity)──> pending_server_confirmation
pending_server_confirmation ──(model: healthy/low-confidence + high triggering score)──> false_alarm  [terminal]
pending_server_confirmation ──(model: mid-confidence, unclear)──> ambiguous_recapture_requested
ambiguous_recapture_requested ──(recapture photo uploaded)──> pending_server_confirmation
pending_server_confirmation ──(model: confident diagnosis)──> confirmed
confirmed ──(follow-up: improved)──> resolved  [terminal]
confirmed ──(follow-up: not improved)──> escalated
escalated ──(recapture + re-diagnosis, or expert visit verdict)──> confirmed  (new advisory version)
```

`farmer_initiated` cases skip straight to `on_device_screened`/`pending_server_confirmation` (no `awaiting_photo`
step, since the farmer proactively opened the scanner rather than being prompted).

---

## 9. Multilingual Content Handling

- Structured domain content (advisory actions, disease names, crop names) is stored trilingual in the seeded
  rule/reference tables themselves (§7.6, §4.3, §4.4) — not run through a translation API at request time.
- Free-text fields (expert notes, follow-up notes) are stored as entered, in whatever language the expert/farmer
  used, and are not translated — they're operational notes, not farmer-facing advisory content.
- API responses include a `language` field matching `current_user.preferred_language` so the client never has to
  guess which localized field it received.

---

## 10. Object Storage (`app/storage/`)

- Interface (`StorageClient` protocol) with two implementations: `SupabaseStorageClient`,
  `VercelBlobStorageClient`, selected via `settings.object_storage_provider` — keeps the self-hosted-MinIO future
  migration (ARCHITECTURE.md §2) to a third implementation, not a rewrite.
- Key convention: `cases/{case_id}/{photo_id}.jpg`.
- Uploads go through the backend (not direct client-to-storage presigned URLs) for the testing deployment, to
  keep the leaf-segmentation-check and `case_photos` row creation atomic with the upload; presigned direct upload
  is a reasonable future optimization once volume requires it, not needed for v1 given Vercel's request size
  limits are adequate for compressed phone photos.
- Photos are never deleted on case resolution — they're the training data source (§7.7).

---

## 11. Deployment (Vercel)

- `api/index.py`:
  ```python
  from app.main import app  # noqa — Vercel's Python ASGI convention picks up `app`
  ```
- `vercel.json` defines the cron schedules from §6.12's table and routes `/api/*` to the Python runtime.
- No local filesystem writes anywhere in `app/` — every write path is either the database or `app/storage/`.
- Cold starts: Earth Engine auth and the diagnosis model load are the two expensive init paths; both are lazy
  (first-request-triggers-load) with a module-level cache, not eager at import time, to keep unrelated endpoints'
  cold starts fast.

---

## 12. Error Handling Conventions

All error responses:

```json
{
  "error": {
    "code": "FARM_NOT_FOUND",
    "message": "Human-readable message in the request's Accept-Language or user's preferred_language",
    "details": {}
  }
}
```

- `app/core/exceptions.py` defines a small hierarchy (`NotFoundError`, `ForbiddenError`, `ValidationError`,
  `UpstreamServiceError` for Open-Meteo/Earth Engine failures) mapped to HTTP 404/403/422/502 respectively via
  FastAPI exception handlers in `main.py`.
- `UpstreamServiceError` from weather/satellite services must never surface as a 500 to the farmer-facing app —
  monitoring endpoints degrade gracefully (return the last known `risk_scores` row with a `stale: true` flag)
  rather than erroring, since a farmer losing their risk view because Earth Engine is briefly down is worse than
  showing slightly stale data.

---

## 13. Testing Requirements

- **Unit tests** (`tests/unit/`): risk fusion weighting math, advisory rule-table resolution, state-machine
  transition validity, thermal-anomaly formula.
- **Integration tests** (`tests/integration/`, against a test Postgres+PostGIS instance): full case lifecycle
  awaiting_photo → confirmed → resolved; sync/batch idempotency (replay the same batch twice, assert no
  duplicates); geo queries (`sourcing/nearby`, `dashboard/hotspots`) against seeded fixture geometries.
- **Fixtures** (`tests/fixtures/`): a small seeded `crop_catalog`/`disease_catalog`/weather-rule set covering at
  least cotton + soybean + one fungal + one pest disease, enough to exercise every branch in §7.5's confidence
  thresholds and §7.6's chemical-recommendation gating.
- External services (Open-Meteo, Earth Engine, the diagnosis model) are mocked in tests via the same interface
  boundaries used for the storage-provider swap (§10) — each service module exposes a protocol/interface so a
  fake implementation can be injected in `tests/fixtures/`.

---

## 14. Explicit Non-Goals (backend, v1)

- No payment/e-commerce endpoints (PRD §9).
- No custom hardware ingestion endpoint — `thermal_readings` is simulated only; adding a real-sensor ingestion
  route is future work, not blocked by this schema (see `resolution` column, §4.7).
- No real-time push notification delivery implementation — endpoints persist the *intent* to notify
  (`cropsap_reports.broadcast_sent_at`, `follow_ups` due-today) but actual FCM/SMS delivery integration is a
  separate, later piece of work.
- No training pipeline execution — `retrain_trigger` only prepares export manifests; `ml/training` runs offline.
