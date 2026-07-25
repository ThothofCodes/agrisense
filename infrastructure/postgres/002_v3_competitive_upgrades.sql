-- AgriSense Smart Farming System
-- Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
-- Author: Thoth of Codes
-- Licensed under the MIT License — see LICENSE file in the project root.

-- ============================================================================
-- AgriSense v3 — Competitive-Insight Hardening Migration
-- ============================================================================
-- Research grounding (real-world platforms studied, June 2026):
--   • Plantix (PEAT GmbH)        — photo-based pest/disease diagnosis, spray diary,
--                                  >90% accuracy across 800 symptoms/60 crops
--   • Climate FieldView (Bayer)  — automated location-error detection (US Patent
--                                  11,714,800), management-zone planting plans,
--                                  "you own your data" / trusted-advisor sharing
--   • OneSoil                    — per-zone productivity classification, NDVI-led
--                                  variable-rate zoning
--   • CropIn Grow                — plot-level AI/ML risk prediction, full
--                                  digitisation of plots/assets/farmers
--   • Microsoft Azure Data Mgr.  — IoT data quality pipelines feeding ML, not
--     for Agriculture / FarmBeats  raw sensor values
--
-- Because this platform informs real planting, fertiliser, and irrigation
-- decisions for food-producing farms, every item below trades convenience for
-- correctness. Defaults fail closed (flag for human review) rather than silently
-- trusting unverified data.
-- ============================================================================

-- ── 1. HARD PHYSICAL BOUNDS ON SENSOR READINGS (defense-in-depth) ────────────
-- Enforced at the DATABASE layer (not just API/zod) so no insertion path —
-- MQTT bridge, batch import, future integrations — can ever write a value
-- that is physically impossible for the sensor type. A bad pH reading driving
-- a lime recommendation is a food-security risk, not a cosmetic bug.

CREATE OR REPLACE FUNCTION validate_sensor_reading() RETURNS TRIGGER AS $$
DECLARE
  lo NUMERIC; hi NUMERIC;
BEGIN
  CASE NEW.sensor_type
    WHEN 'SOIL_PH'                   THEN lo := 0;    hi := 14;
    WHEN 'SOIL_MOISTURE'             THEN lo := 0;    hi := 100;
    WHEN 'NITROGEN'                  THEN lo := 0;    hi := 500;
    WHEN 'PHOSPHORUS'                THEN lo := 0;    hi := 300;
    WHEN 'POTASSIUM'                 THEN lo := 0;    hi := 1000;
    WHEN 'SOIL_TEMP'                 THEN lo := -10;  hi := 60;
    WHEN 'ELECTRICAL_CONDUCTIVITY'   THEN lo := 0;    hi := 20;
    WHEN 'ORGANIC_MATTER'            THEN lo := 0;    hi := 100;
    WHEN 'AMBIENT_TEMP'              THEN lo := -20;  hi := 60;
    WHEN 'HUMIDITY'                  THEN lo := 0;    hi := 100;
    WHEN 'RAINFALL'                  THEN lo := 0;    hi := 600;  -- mm in a single reading window
    WHEN 'SOLAR_RADIATION'           THEN lo := 0;    hi := 45;   -- MJ/m^2/day theoretical max ~ 40
    WHEN 'WIND_SPEED'                THEN lo := 0;    hi := 250;  -- km/h, hurricane ceiling
    WHEN 'WIND_DIRECTION'            THEN lo := 0;    hi := 360;
    ELSE lo := NULL; hi := NULL;
  END CASE;

  IF lo IS NOT NULL AND (NEW.value < lo OR NEW.value > hi) THEN
    RAISE EXCEPTION 'AS-022: Sensor reading % % is outside physically possible range [% , %] for type %',
      NEW.value, COALESCE(NEW.unit,''), lo, hi, NEW.sensor_type;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_sensor_reading ON sensor_readings;
CREATE TRIGGER trg_validate_sensor_reading
  BEFORE INSERT OR UPDATE ON sensor_readings
  FOR EACH ROW EXECUTE FUNCTION validate_sensor_reading();

-- ── 2. SENSOR TRUST / CALIBRATION SCORING ────────────────────────────────────
-- Insight: professional ag-sensor fleets (Arable, Semios) degrade trust in a
-- reading as calibration age increases and as a node's own anomaly history
-- grows, rather than treating every sensor as equally reliable forever.

ALTER TABLE sensor_nodes
  ADD COLUMN IF NOT EXISTS trust_score        SMALLINT DEFAULT 100 CHECK (trust_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS anomaly_count_7d    INTEGER  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS location_flag       BOOLEAN  DEFAULT FALSE;

CREATE OR REPLACE FUNCTION recompute_node_trust(p_node_id UUID) RETURNS SMALLINT AS $$
DECLARE
  v_node sensor_nodes%ROWTYPE;
  v_days_since_cal NUMERIC;
  v_anomaly_rate NUMERIC;
  v_score SMALLINT;
BEGIN
  SELECT * INTO v_node FROM sensor_nodes WHERE id = p_node_id;
  IF v_node IS NULL THEN RETURN NULL; END IF;

  v_days_since_cal := COALESCE(EXTRACT(DAY FROM NOW() - v_node.calibrated_at), 999);

  SELECT COUNT(*) INTO v_anomaly_rate
  FROM sensor_readings
  WHERE node_id = p_node_id AND time > NOW() - INTERVAL '7 days' AND is_anomaly = true;

  -- Start at 100, lose up to 40 pts for calibration age (linear over 180 days),
  -- lose up to 40 pts for anomaly frequency (5+ anomalies/week = full penalty),
  -- lose 20 pts flat if a location_flag is currently set (Climate FieldView-style
  -- automated location-error detection).
  v_score := 100
    - LEAST(40, ROUND(v_days_since_cal / 180.0 * 40))
    - LEAST(40, ROUND(v_anomaly_rate / 5.0 * 40))
    - (CASE WHEN v_node.location_flag THEN 20 ELSE 0 END);

  v_score := GREATEST(0, v_score);

  UPDATE sensor_nodes SET trust_score = v_score, anomaly_count_7d = v_anomaly_rate WHERE id = p_node_id;
  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

-- ── 3. AUTOMATED LOCATION-ERROR DETECTION ────────────────────────────────────
-- Direct analogue of Climate FieldView's "Automated detection of errors in
-- location data in agricultural operations" (US 11,714,800). A sensor that
-- reports itself 30+ km from its registered farm almost certainly has a GPS
-- fault or was physically relocated without being re-provisioned — either way,
-- its readings should not silently feed the SFS/recommendation engine.

CREATE OR REPLACE FUNCTION haversine_km(lat1 NUMERIC, lon1 NUMERIC, lat2 NUMERIC, lon2 NUMERIC)
RETURNS NUMERIC AS $$
DECLARE
  r NUMERIC := 6371;
  dlat NUMERIC; dlon NUMERIC; a NUMERIC;
BEGIN
  IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN RETURN NULL; END IF;
  dlat := radians(lat2 - lat1);
  dlon := radians(lon2 - lon1);
  a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon/2)^2;
  RETURN r * 2 * atan2(sqrt(a), sqrt(1-a));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION check_node_location() RETURNS TRIGGER AS $$
DECLARE
  v_farm farms%ROWTYPE;
  v_dist NUMERIC;
BEGIN
  SELECT * INTO v_farm FROM farms WHERE id = NEW.farm_id;
  IF v_farm IS NULL OR NEW.latitude IS NULL THEN RETURN NEW; END IF;

  v_dist := haversine_km(NEW.latitude, NEW.longitude, v_farm.latitude, v_farm.longitude);

  IF v_dist IS NOT NULL AND v_dist > 30 THEN
    NEW.location_flag := TRUE;
    INSERT INTO audit_logs (action, entity_type, entity_id, new_value)
    VALUES ('LOCATION_ANOMALY_DETECTED', 'sensor_node', NEW.id,
            jsonb_build_object('distance_km', round(v_dist,1), 'farm_id', NEW.farm_id));
  ELSE
    NEW.location_flag := FALSE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_node_location ON sensor_nodes;
CREATE TRIGGER trg_check_node_location
  BEFORE INSERT OR UPDATE OF latitude, longitude ON sensor_nodes
  FOR EACH ROW EXECUTE FUNCTION check_node_location();

-- ── 4. PROACTIVE GDD-DEFICIT BASELINE ────────────────────────────────────────
-- v2.0 declared a GDD_DEFICIT alert type but never implemented the comparison
-- baseline — it could never actually fire. Climate FieldView's design
-- philosophy is explicit: "stop problems before they impact yield" rather than
-- reacting after the fact. typical_days_to_maturity lets the alert engine
-- compute an expected-vs-actual GDD trajectory and warn early.

ALTER TABLE crops
  ADD COLUMN IF NOT EXISTS typical_days_to_maturity INTEGER;

UPDATE crops SET typical_days_to_maturity = CASE name
  WHEN 'Maize'     THEN 120
  WHEN 'Wheat'      THEN 150
  WHEN 'Rice'       THEN 115
  WHEN 'Soybeans'   THEN 100
  WHEN 'Tomatoes'   THEN 100
  WHEN 'Potatoes'   THEN 95
  WHEN 'Sorghum'    THEN 100
  WHEN 'Cassava'    THEN 300
  WHEN 'Beans'      THEN 70
  WHEN 'Sunflower'  THEN 95
  WHEN 'Cabbage'    THEN 80
  WHEN 'Lettuce'    THEN 55
  ELSE 100
END WHERE typical_days_to_maturity IS NULL;

-- ── 5. RECOMMENDATION CONFIDENCE & HUMAN-REVIEW GATING ───────────────────────
-- Food-security-grade decision support must distinguish "the model is
-- confident" from "the model had to guess because data was missing." A
-- recommendation built on stale/absent sensor data is auto-flagged for
-- agronomist review rather than presented with false authority.

ALTER TABLE crop_recommendations
  ADD COLUMN IF NOT EXISTS data_completeness_pct   SMALLINT,
  ADD COLUMN IF NOT EXISTS requires_agronomist_review BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reviewed_by              UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at              TIMESTAMPTZ;

-- ── 6. WEATHER SOURCE-AGREEMENT TRACKING ─────────────────────────────────────
-- Insight: no single weather API is ground truth. When OpenWeatherMap and
-- Tomorrow.io disagree materially, that disagreement is itself a signal the
-- UI and alert engine should see, not silently average away.

ALTER TABLE weather_readings
  ADD COLUMN IF NOT EXISTS sources_used      TEXT[],
  ADD COLUMN IF NOT EXISTS source_spread_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS low_confidence    BOOLEAN DEFAULT FALSE;

-- ── 7. TREATMENT / SPRAY DIARY (Plantix-inspired) ────────────────────────────
-- Plantix's spray diary is one of its most-used features: a dated, auditable
-- record of every chemical/organic input applied. For food security this also
-- supports pre-harvest-interval (PHI) compliance — i.e. flagging if a farmer
-- might harvest before a pesticide's safe withdrawal period has elapsed.

CREATE TYPE treatment_type AS ENUM ('PESTICIDE','HERBICIDE','FUNGICIDE','FERTILISER','ORGANIC','BIOLOGICAL_CONTROL','OTHER');

CREATE TABLE IF NOT EXISTS treatment_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id               UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id               UUID REFERENCES field_zones(id),
  crop_cycle_id         UUID REFERENCES crop_cycles(id),
  applied_by            UUID REFERENCES users(id),
  treatment_type        treatment_type NOT NULL,
  product_name          VARCHAR(150) NOT NULL,
  active_ingredient     VARCHAR(150),
  application_rate      DECIMAL(10,2),
  rate_unit             VARCHAR(20),
  pre_harvest_interval_days SMALLINT,
  applied_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- safe_harvest_after intentionally NOT a generated column: timestamptz + interval
  -- is STABLE not IMMUTABLE in Postgres (DST-dependent), which Postgres rejects for
  -- GENERATED columns. Computed instead in treatmentService.ts on every read/write.
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treatment_logs_farm ON treatment_logs(farm_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_logs_cycle ON treatment_logs(crop_cycle_id);

-- ── 8. PHOTO-BASED DIAGNOSIS QUEUE (Plantix-inspired) ────────────────────────
-- Plantix achieves >90% accuracy on 800+ symptoms because it was trained on a
-- vast labelled image corpus over years. AgriSense does not yet have that
-- corpus or a trained CV model — claiming otherwise would be the exact kind of
-- false-confidence this build explicitly rejects. Honest architecture: every
-- submitted photo is logged for future model training AND routed to a human
-- agronomist review queue today. The endpoint is fully real; the "AI verdict"
-- is, for now, deliberately absent rather than fabricated.

CREATE TYPE diagnosis_status AS ENUM ('PENDING_REVIEW','AGRONOMIST_REVIEWED','MODEL_DIAGNOSED','DISMISSED');

CREATE TABLE IF NOT EXISTS photo_diagnoses (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id           UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id           UUID REFERENCES field_zones(id),
  crop_cycle_id     UUID REFERENCES crop_cycles(id),
  submitted_by      UUID REFERENCES users(id),
  image_ref         TEXT NOT NULL,         -- storage path/URL; binary not stored in Postgres
  image_size_bytes  INTEGER,
  symptom_tags      TEXT[],                -- farmer-supplied tags: 'yellow leaves','holes','wilting'...
  status            diagnosis_status DEFAULT 'PENDING_REVIEW',
  model_label       VARCHAR(150),          -- populated once a trained CV model exists
  model_confidence  SMALLINT,
  agronomist_notes  TEXT,
  reviewed_by       UUID REFERENCES users(id),
  reviewed_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photo_diag_farm ON photo_diagnoses(farm_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photo_diag_status ON photo_diagnoses(status);

-- ── 9. TRUSTED-ADVISOR SHARING (Climate FieldView-inspired) ─────────────────
-- FieldView's core data-ownership promise: farmers decide who else can see
-- their farm. Implemented as revocable, expiring share tokens rather than
-- permanent account merges — the farmer stays in control.

CREATE TABLE IF NOT EXISTS farm_shares (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id       UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  token         VARCHAR(64) UNIQUE NOT NULL,
  role          VARCHAR(20) NOT NULL DEFAULT 'READ_ONLY' CHECK (role IN ('READ_ONLY','AGRONOMIST')),
  created_by    UUID NOT NULL REFERENCES users(id),
  accepted_by   UUID REFERENCES users(id),
  accepted_at   TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  revoked       BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_farm_shares_token ON farm_shares(token) WHERE revoked = FALSE;

-- ── 10. DATA-SHARING CONSENT (FieldView "you own your data") ─────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS data_sharing_consent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_updated_at    TIMESTAMPTZ;

-- ── 11. PER-ZONE PRODUCTIVITY CLASSIFICATION (OneSoil-inspired) ──────────────
ALTER TABLE field_zones
  ADD COLUMN IF NOT EXISTS productivity_class VARCHAR(20),  -- HIGH / MEDIUM / LOW
  ADD COLUMN IF NOT EXISTS last_classified_at TIMESTAMPTZ;

COMMIT;
