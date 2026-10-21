-- ==============================================================================
-- CropSathi — Supabase / PostgreSQL DDL
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ==============================================================================

-- Enable PostGIS for polygon / point storage and spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─── 1. USERS ────────────────────────────────────────────────────────────────
-- We keep custom bcrypt passwords + JWT tokens.
-- Supabase Auth is NOT used (zero frontend changes required).

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(50)  NOT NULL,
  phone_number    VARCHAR(15)  NOT NULL UNIQUE,  -- 10-digit Indian mobile
  password        TEXT         NOT NULL,          -- bcrypt hash
  role            VARCHAR(20)  NOT NULL DEFAULT 'farmer'
                  CHECK (role IN ('farmer','agronomist','admin')),
  preferred_language VARCHAR(5) NOT NULL DEFAULT 'en'
                  CHECK (preferred_language IN ('en','hi','mr','gu','ta','te','kn','pa','bn','or','as','ur','ml')),
  profile_photo   TEXT         DEFAULT '',
  -- farmDetails embedded as JSONB (state, district, village, lat/lng, etc.)
  farm_details    JSONB        NOT NULL DEFAULT '{}',
  notification_preferences JSONB NOT NULL DEFAULT '{"pushEnabled":true,"severeAlertsEnabled":true,"photoPromptsEnabled":true}',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_phone    ON users(phone_number);
CREATE INDEX IF NOT EXISTS idx_users_district ON users((farm_details->>'district'));

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 2. FIELDS ───────────────────────────────────────────────────────────────
-- polygon stored as native PostGIS GEOMETRY so ST_Area, ST_Centroid,
-- ST_Intersects all work natively for satellite bbox queries.

CREATE TABLE IF NOT EXISTS fields (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                  VARCHAR(100) NOT NULL,
  crop_type             VARCHAR(50)  NOT NULL
                        CHECK (crop_type IN ('Wheat','Rice','Maize','Cotton','Sugarcane','Potato','Grapes','Soybean','Tur','Other')),
  crop_stage            VARCHAR(20)
                        CHECK (crop_stage IN ('sowing','vegetative','flowering','fruiting','maturity','harvested')),
  sowing_date           DATE         NOT NULL,
  -- polygon: raw [{lat,lng}] array kept for frontend compatibility
  polygon               JSONB        NOT NULL DEFAULT '[]',
  -- PostGIS native polygon (WGS84) — derived from polygon above
  boundary              GEOMETRY(Polygon, 4326),
  center_lat            DOUBLE PRECISION,
  center_lng            DOUBLE PRECISION,
  area_in_hectares      NUMERIC(10,4) NOT NULL DEFAULT 0,
  area_in_acres         NUMERIC(10,4) NOT NULL DEFAULT 0,
  soil_type             VARCHAR(20)  NOT NULL DEFAULT 'Other'
                        CHECK (soil_type IN ('Alluvial','Black','Red','Laterite','Clayey','Sandy','Loamy','Other')),
  status                VARCHAR(20)  NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive','archived')),
  is_vegetation_valid   BOOLEAN      NOT NULL DEFAULT TRUE,
  deleted_at            TIMESTAMPTZ,
  last_weather_poll_at  TIMESTAMPTZ,
  last_risk_score_at    TIMESTAMPTZ,
  last_photo_prompt_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fields_user_id    ON fields(user_id);
CREATE INDEX IF NOT EXISTS idx_fields_status      ON fields(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_fields_boundary    ON fields USING GIST(boundary);

CREATE TRIGGER trg_fields_updated_at
  BEFORE UPDATE ON fields
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 3. CROP CATALOGS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crop_catalogs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(50)  NOT NULL UNIQUE,
  name_en               VARCHAR(100) NOT NULL,
  name_hi               VARCHAR(100) NOT NULL DEFAULT '',
  name_mr               VARCHAR(100) NOT NULL DEFAULT '',
  typical_sowing_window JSONB        NOT NULL DEFAULT '{}',
  priority_maharashtra  BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_crop_catalogs_updated_at
  BEFORE UPDATE ON crop_catalogs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 4. DISEASE CATALOGS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS disease_catalogs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  code            VARCHAR(100) NOT NULL UNIQUE,
  name_en         VARCHAR(200) NOT NULL,
  name_hi         VARCHAR(200) NOT NULL DEFAULT '',
  name_mr         VARCHAR(200) NOT NULL DEFAULT '',
  crop_code       VARCHAR(50)  NOT NULL REFERENCES crop_catalogs(code),
  pathogen_type   VARCHAR(30)  NOT NULL
                  CHECK (pathogen_type IN ('fungal','bacterial','viral','pest','nutrient_deficiency','abiotic')),
  severity_scale  VARCHAR(20)  NOT NULL DEFAULT 'medium'
                  CHECK (severity_scale IN ('low','medium','high','critical')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disease_catalogs_crop ON disease_catalogs(crop_code);

CREATE TRIGGER trg_disease_catalogs_updated_at
  BEFORE UPDATE ON disease_catalogs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 5. CROP BASELINES ───────────────────────────────────────────────────────
-- Dynamic NDVI/NDRE percentile baselines per crop+region, recomputed weekly.

CREATE TABLE IF NOT EXISTS crop_baselines (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  crop_type           VARCHAR(50)  NOT NULL,
  region              VARCHAR(100) NOT NULL DEFAULT 'global',
  ndvi_p05            NUMERIC(5,4) NOT NULL DEFAULT 0.0,
  ndvi_p95            NUMERIC(5,4) NOT NULL DEFAULT 0.9,
  ndre_p05            NUMERIC(5,4) NOT NULL DEFAULT -0.1,
  ndre_p95            NUMERIC(5,4) NOT NULL DEFAULT 0.7,
  sample_size         INTEGER      NOT NULL DEFAULT 0,
  last_recomputed_at  TIMESTAMPTZ,
  source              VARCHAR(20)  NOT NULL DEFAULT 'default'
                      CHECK (source IN ('calibrated','default')),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (crop_type, region)
);

CREATE TRIGGER trg_crop_baselines_updated_at
  BEFORE UPDATE ON crop_baselines
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 6. NDVI READINGS ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ndvi_readings (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id               UUID         NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  observed_at           TIMESTAMPTZ  NOT NULL,
  ndvi                  NUMERIC(6,4) NOT NULL CHECK (ndvi BETWEEN -1 AND 1),
  ndre                  NUMERIC(6,4)           CHECK (ndre BETWEEN -1 AND 1),
  cloud_cover_pct       NUMERIC(5,2) NOT NULL DEFAULT 0,
  trailing_avg_ndvi_28d NUMERIC(6,4),
  anomaly_score         NUMERIC(5,4) NOT NULL DEFAULT 0,
  pixel_count_pure_crop INTEGER,
  ndvi_grid             JSONB,   -- 10x10 grid array
  ndre_grid             JSONB,   -- 10x10 grid array
  scene_source          VARCHAR(20)  NOT NULL DEFAULT 'simulated'
                        CHECK (scene_source IN ('sentinel-2','simulated')),
  scene_id              VARCHAR(200),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ndvi_farm_observed ON ndvi_readings(farm_id, observed_at DESC);

CREATE TRIGGER trg_ndvi_readings_updated_at
  BEFORE UPDATE ON ndvi_readings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 7. THERMAL READINGS ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS thermal_readings (
  id                        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id                   UUID         NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  observed_at               TIMESTAMPTZ  NOT NULL,
  estimated_canopy_temp_c   NUMERIC(6,2) NOT NULL,
  baseline_temp_c           NUMERIC(6,2),
  anomaly_c                 NUMERIC(6,2) NOT NULL DEFAULT 0,
  resolution                VARCHAR(30)  NOT NULL DEFAULT 'farm_simulated'
                            CHECK (resolution IN ('district','farm_simulated','landsat-8-9')),
  thermal_grid              JSONB,   -- 10x10 grid array
  scene_source              VARCHAR(20)  NOT NULL DEFAULT 'formula'
                            CHECK (scene_source IN ('landsat-8-9','formula')),
  scene_id                  VARCHAR(200),
  cloud_cover_pct           NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thermal_farm_observed ON thermal_readings(farm_id, observed_at DESC);

CREATE TRIGGER trg_thermal_readings_updated_at
  BEFORE UPDATE ON thermal_readings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 8. RISK SCORES ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS risk_scores (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id                 UUID         NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  computed_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  weather_component       NUMERIC(5,4) NOT NULL DEFAULT 0,
  ndvi_component          NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  ndre_component          NUMERIC(5,4) NOT NULL DEFAULT 0,
  thermal_component       NUMERIC(5,4) NOT NULL DEFAULT 0.5,
  pest_history_component  NUMERIC(5,4) NOT NULL DEFAULT 0,
  composite_score         NUMERIC(5,2),
  health_level            VARCHAR(20)  CHECK (health_level IN ('healthy','watch','elevated','high')),
  stale_signals           JSONB        NOT NULL DEFAULT '[]',
  weights_used            JSONB,
  triggered_alert         BOOLEAN      NOT NULL DEFAULT FALSE,
  disease_hypothesis      VARCHAR(200),
  matched_weather_rules   JSONB        NOT NULL DEFAULT '[]',
  threshold_used          NUMERIC(4,3) NOT NULL DEFAULT 0.6,
  inputs_snapshot         JSONB,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_scores_farm ON risk_scores(farm_id, computed_at DESC);

CREATE TRIGGER trg_risk_scores_updated_at
  BEFORE UPDATE ON risk_scores
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 9. DIAGNOSIS CASES ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS diagnosis_cases (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id                 UUID         NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  user_id                 UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  triggering_risk_score_id UUID        REFERENCES risk_scores(id),
  triggered_by            VARCHAR(30)  NOT NULL
                          CHECK (triggered_by IN ('risk_alert','farmer_initiated')),
  status                  VARCHAR(30)  NOT NULL DEFAULT 'awaiting_photo'
                          CHECK (status IN ('awaiting_photo','diagnosing','report_ready','retry_failed','deleted')),
  -- AI diagnosis result — stored as JSONB (replaces mixed nested Mongoose fields)
  gemini_result           JSONB,
  final_disease_code      VARCHAR(200),
  final_severity          VARCHAR(20)  CHECK (final_severity IN ('none','mild','moderate','severe')),
  confidence              NUMERIC(5,4),
  outcome                 VARCHAR(20)  CHECK (outcome IN ('confirmed','false_alarm','expert_review','retry')),
  requires_expert_review  BOOLEAN      NOT NULL DEFAULT FALSE,
  gps_lat                 DOUBLE PRECISION,
  gps_lng                 DOUBLE PRECISION,
  captured_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_diagnosis_farm_status   ON diagnosis_cases(farm_id, status);
CREATE INDEX IF NOT EXISTS idx_diagnosis_farm_created  ON diagnosis_cases(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagnosis_expert_review ON diagnosis_cases(status, requires_expert_review);

CREATE TRIGGER trg_diagnosis_cases_updated_at
  BEFORE UPDATE ON diagnosis_cases
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 10. CASE PHOTOS ─────────────────────────────────────────────────────────
-- storageKey → Supabase Storage path (bucket: case-photos/<case_id>/<filename>)

CREATE TABLE IF NOT EXISTS case_photos (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID        NOT NULL REFERENCES diagnosis_cases(id) ON DELETE CASCADE,
  storage_key                 TEXT        NOT NULL,   -- path inside bucket
  storage_url                 TEXT,                   -- full public CDN URL
  filename                    VARCHAR(500) NOT NULL DEFAULT '',
  mime_type                   VARCHAR(50)  NOT NULL DEFAULT 'image/jpeg',
  file_size                   INTEGER      NOT NULL DEFAULT 0,
  is_recapture                BOOLEAN      NOT NULL DEFAULT FALSE,
  leaf_segmentation_applied   BOOLEAN      NOT NULL DEFAULT FALSE,
  uploaded_at                 TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_case_photos_case ON case_photos(case_id, uploaded_at DESC);

CREATE TRIGGER trg_case_photos_updated_at
  BEFORE UPDATE ON case_photos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 11. ADVISORIES ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS advisories (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                 UUID        NOT NULL REFERENCES diagnosis_cases(id) ON DELETE CASCADE,
  version                 INTEGER     NOT NULL DEFAULT 1,
  disease_code            VARCHAR(200) NOT NULL,
  severity                VARCHAR(20) NOT NULL
                          CHECK (severity IN ('low','medium','high','critical')),
  crop_stage              VARCHAR(20) NOT NULL DEFAULT 'vegetative'
                          CHECK (crop_stage IN ('sowing','vegetative','flowering','fruiting','maturity','harvested')),
  summary                 TEXT        NOT NULL DEFAULT '',
  pathogen_name           VARCHAR(200) NOT NULL DEFAULT '',
  symptoms                TEXT        NOT NULL DEFAULT '',
  -- Array of {type, action, productName, dosage, frequency, timing, ...}
  remedies                JSONB       NOT NULL DEFAULT '[]',
  ipm_cultural_actions    JSONB       NOT NULL DEFAULT '[]',
  ipm_biological_actions  JSONB       NOT NULL DEFAULT '[]',
  chemical_recommendation JSONB,
  follow_up_days          INTEGER,
  escalate_to_cropsap     BOOLEAN     NOT NULL DEFAULT FALSE,
  escalation_reason       TEXT,
  source                  VARCHAR(20) NOT NULL DEFAULT 'rules'
                          CHECK (source IN ('gemini','rules')),
  is_generic              BOOLEAN     NOT NULL DEFAULT FALSE,
  prevention              JSONB       NOT NULL DEFAULT '[]',
  generated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_advisories_case ON advisories(case_id, version DESC);

CREATE TRIGGER trg_advisories_updated_at
  BEFORE UPDATE ON advisories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 12. FOLLOW UPS ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS follow_ups (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id           UUID        NOT NULL REFERENCES diagnosis_cases(id) ON DELETE CASCADE,
  advisory_id       UUID        NOT NULL REFERENCES advisories(id) ON DELETE CASCADE,
  farm_id           UUID        REFERENCES fields(id),
  user_id           UUID        REFERENCES users(id),
  scheduled_for     TIMESTAMPTZ NOT NULL,
  status            VARCHAR(30) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','completed_improved','completed_unimproved','unresponsive','escalated')),
  completed_at      TIMESTAMPTZ,
  notes             TEXT,
  farmer_response   JSONB,   -- {appliedRemedy, cropCondition, photoUploaded}
  reminder_count    INTEGER  NOT NULL DEFAULT 0,
  last_reminder_sent TIMESTAMPTZ,
  escalated_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_user_status ON follow_ups(user_id, status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_follow_ups_case_status ON follow_ups(case_id, status);

CREATE TRIGGER trg_follow_ups_updated_at
  BEFORE UPDATE ON follow_ups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 13. REMINDERS ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  advisory_id     UUID        NOT NULL REFERENCES advisories(id) ON DELETE CASCADE,
  reminder_type   VARCHAR(30) NOT NULL
                  CHECK (reminder_type IN ('application','reapplication','harvest_wait')),
  due_at          TIMESTAMPTZ NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','done','snoozed','missed')),
  snooze_count    INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_advisory ON reminders(advisory_id, reminder_type, due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_due       ON reminders(due_at, status);

CREATE TRIGGER trg_reminders_updated_at
  BEFORE UPDATE ON reminders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 14. NOTIFICATIONS ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notifications (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  farm_id         UUID        REFERENCES fields(id),
  case_id         UUID        REFERENCES diagnosis_cases(id),
  advisory_id     UUID        REFERENCES advisories(id),
  follow_up_id    UUID        REFERENCES follow_ups(id),
  type            VARCHAR(40) NOT NULL
                  CHECK (type IN ('advisory_ready','remedy_reminder','reapplication_reminder','follow_up_check','harvest_safety_wait','escalation_alert','weather_alert','photo_prompt')),
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL,
  priority        VARCHAR(10) NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low','medium','high','urgent')),
  deep_link       TEXT,
  read            BOOLEAN     NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  action_taken    VARCHAR(20) CHECK (action_taken IN ('done','snoozed','dismissed')),
  snoozed_until   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_farm_type  ON notifications(farm_id, type, created_at DESC);

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ─── 15. WEATHER READINGS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weather_readings (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  farm_id         UUID         NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  source          VARCHAR(30)  NOT NULL DEFAULT 'open_meteo'
                  CHECK (source IN ('open_meteo', 'imd')),
  observed_at     TIMESTAMPTZ  NOT NULL,
  temperature_c   NUMERIC(5,2),
  humidity_pct    NUMERIC(5,2),
  rainfall_mm_24h NUMERIC(6,2) DEFAULT 0,
  wind_speed_ms   NUMERIC(5,2) DEFAULT 0,
  soil_temp_c     NUMERIC(5,2),
  raw_payload     JSONB,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_farm_observed ON weather_readings(farm_id, observed_at DESC);

CREATE TRIGGER trg_weather_readings_updated_at
  BEFORE UPDATE ON weather_readings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

