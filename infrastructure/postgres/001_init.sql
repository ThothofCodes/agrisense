-- AgriSense Smart Farming System
-- Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
-- Author: Thoth of Codes
-- Licensed under the MIT License — see LICENSE file in the project root.

-- ============================================================
-- AgriSense Database Schema — PostgreSQL 15 + TimescaleDB
-- ============================================================

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── ENUMS ─────────────────────────────────────────────────────────────────────
CREATE TYPE user_role AS ENUM ('ADMIN', 'PROFESSIONAL', 'FARMER', 'BASIC');
CREATE TYPE subscription_tier AS ENUM ('FREE', 'FARMER', 'PROFESSIONAL', 'ENTERPRISE');
CREATE TYPE sensor_type AS ENUM ('SOIL_PH', 'SOIL_MOISTURE', 'NITROGEN', 'PHOSPHORUS', 'POTASSIUM', 'SOIL_TEMP', 'ELECTRICAL_CONDUCTIVITY', 'ORGANIC_MATTER', 'AMBIENT_TEMP', 'HUMIDITY', 'RAINFALL', 'SOLAR_RADIATION', 'WIND_SPEED', 'WIND_DIRECTION');
CREATE TYPE alert_severity AS ENUM ('ADVISORY', 'WATCH', 'WARNING', 'CRITICAL');
CREATE TYPE alert_type AS ENUM ('FROST_WARNING','DROUGHT_WATCH','HEAVY_RAINFALL','HEAT_STRESS','HIGH_WIND','PEST_RISK','HAIL_PROBABILITY','GDD_DEFICIT','HARVEST_WINDOW','SOIL_PH_DEVIATION','NPK_DEFICIENCY','SENSOR_OFFLINE','ANOMALY_DETECTED');
CREATE TYPE alert_status AS ENUM ('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
CREATE TYPE node_status AS ENUM ('ONLINE', 'OFFLINE', 'LOW_BATTERY', 'CALIBRATION_DUE', 'FAULT');
CREATE TYPE growth_stage AS ENUM ('PRE_PLANTING', 'GERMINATION', 'EMERGENCE', 'VEGETATIVE', 'TILLERING', 'STEM_ELONGATION', 'HEADING', 'FLOWERING', 'GRAIN_FILL', 'MATURITY', 'HARVEST', 'POST_HARVEST');
CREATE TYPE season_type AS ENUM ('WARM', 'COOL', 'WET', 'DRY');

-- ── 1. USERS ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  full_name       VARCHAR(255) NOT NULL,
  phone           VARCHAR(20),
  role            user_role NOT NULL DEFAULT 'BASIC',
  tier            subscription_tier NOT NULL DEFAULT 'FREE',
  tier_expires_at TIMESTAMPTZ,
  language        VARCHAR(10) DEFAULT 'en',
  timezone        VARCHAR(50) DEFAULT 'Africa/Nairobi',
  mfa_enabled     BOOLEAN DEFAULT FALSE,
  mfa_secret      VARCHAR(64),
  last_login_at   TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. FARMS ──────────────────────────────────────────────────────────────────
CREATE TABLE farms (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            VARCHAR(255) NOT NULL,
  description     TEXT,
  -- Location
  latitude        DECIMAL(10,6) NOT NULL,
  longitude       DECIMAL(10,6) NOT NULL,
  elevation_m     DECIMAL(8,2),
  county          VARCHAR(100),
  country         VARCHAR(100) DEFAULT 'Kenya',
  -- Farm profile
  total_area_ha   DECIMAL(10,2) NOT NULL,
  rainfall_zone   VARCHAR(50), -- Arid / Semi-Arid / Sub-Humid / Humid
  soil_type       VARCHAR(50),
  -- Settings
  timezone        VARCHAR(50) DEFAULT 'Africa/Nairobi',
  season_zone     VARCHAR(20) DEFAULT 'EAF', -- East Africa
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. FIELD ZONES ────────────────────────────────────────────────────────────
CREATE TABLE field_zones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  area_ha         DECIMAL(10,2),
  -- GeoJSON polygon (optional, requires postgis)
  -- boundary      GEOMETRY(POLYGON, 4326),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. SENSOR NODES ───────────────────────────────────────────────────────────
CREATE TABLE sensor_nodes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES field_zones(id),
  device_id       VARCHAR(64) UNIQUE NOT NULL, -- LoRaWAN DevEUI or IMEI
  name            VARCHAR(100),
  -- Location
  latitude        DECIMAL(10,6),
  longitude       DECIMAL(10,6),
  depth_cm        SMALLINT DEFAULT 15,
  -- Hardware
  firmware_version VARCHAR(20),
  battery_pct     SMALLINT,
  solar_voltage   DECIMAL(5,2),
  -- Status
  status          node_status DEFAULT 'OFFLINE',
  last_seen_at    TIMESTAMPTZ,
  calibrated_at   TIMESTAMPTZ,
  next_calibration TIMESTAMPTZ,
  -- Sensor capabilities (bitmask or JSON)
  capabilities    JSONB DEFAULT '[]',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. SENSOR READINGS (TimescaleDB hypertable) ───────────────────────────────
CREATE TABLE sensor_readings (
  time            TIMESTAMPTZ NOT NULL,
  node_id         UUID NOT NULL REFERENCES sensor_nodes(id) ON DELETE CASCADE,
  farm_id         UUID NOT NULL,
  sensor_type     sensor_type NOT NULL,
  value           DECIMAL(12,4) NOT NULL,
  unit            VARCHAR(20),
  quality_score   SMALLINT DEFAULT 100, -- 0-100, anomaly score
  is_anomaly      BOOLEAN DEFAULT FALSE,
  raw_payload     JSONB
);

-- Convert to TimescaleDB hypertable
SELECT create_hypertable('sensor_readings', 'time', chunk_time_interval => INTERVAL '7 days');

-- TimescaleDB retention policy — raw readings kept 2 years
SELECT add_retention_policy('sensor_readings', INTERVAL '2 years');

-- Continuous aggregate: hourly averages
CREATE MATERIALIZED VIEW sensor_readings_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', time) AS bucket,
  node_id,
  farm_id,
  sensor_type,
  AVG(value)   AS avg_value,
  MIN(value)   AS min_value,
  MAX(value)   AS max_value,
  COUNT(*)     AS reading_count
FROM sensor_readings
GROUP BY bucket, node_id, farm_id, sensor_type
WITH NO DATA;

SELECT add_continuous_aggregate_policy('sensor_readings_hourly',
  start_offset => INTERVAL '3 hours',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

-- ── 6. SOIL FEASIBILITY SCORES ────────────────────────────────────────────────
CREATE TABLE soil_feasibility_scores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES field_zones(id),
  computed_at     TIMESTAMPTZ DEFAULT NOW(),
  crop_id         UUID, -- if crop-specific, null = general
  -- Component scores (0-100 each)
  ph_score        SMALLINT,
  nitrogen_score  SMALLINT,
  phosphorus_score SMALLINT,
  potassium_score SMALLINT,
  moisture_score  SMALLINT,
  organic_matter_score SMALLINT,
  ec_score        SMALLINT,
  soil_temp_score SMALLINT,
  -- Composite
  total_score     SMALLINT NOT NULL,
  -- Raw input snapshot
  inputs          JSONB,
  -- Flags
  om_stale        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. CROPS DATABASE ─────────────────────────────────────────────────────────
CREATE TABLE crops (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100) NOT NULL,
  scientific_name VARCHAR(150),
  category        VARCHAR(50), -- Cereal / Legume / Vegetable / Root / Fruit
  season_type     season_type,
  -- GDD parameters
  gdd_base_temp   DECIMAL(5,2) NOT NULL,
  gdd_emergence   DECIMAL(8,2),
  gdd_flowering   DECIMAL(8,2),
  gdd_maturity    DECIMAL(8,2),
  -- Soil requirements
  ph_min          DECIMAL(4,2),
  ph_max          DECIMAL(4,2),
  ph_optimal      DECIMAL(4,2),
  n_requirement   VARCHAR(20), -- LOW / MEDIUM / HIGH
  p_requirement   VARCHAR(20),
  k_requirement   VARCHAR(20),
  -- Climate
  min_temp_c      DECIMAL(5,2),
  max_temp_c      DECIMAL(5,2),
  min_rainfall_mm INTEGER,
  max_rainfall_mm INTEGER,
  -- Planting
  planting_depth_cm DECIMAL(5,2),
  spacing_cm      INTEGER,
  -- Economics (per ha baselines)
  avg_yield_t_ha  DECIMAL(6,2),
  price_per_t_usd DECIMAL(8,2),
  -- Metadata
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. PLANTING CALENDAR OVERRIDES ────────────────────────────────────────────
CREATE TABLE planting_calendar (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  crop_id         UUID NOT NULL REFERENCES crops(id),
  season_zone     VARCHAR(20) NOT NULL, -- EAF, SAF, WEU, NAAS etc.
  season_label    VARCHAR(50),          -- "Long Rains", "Short Rains"
  plant_month_start SMALLINT,           -- 1-12
  plant_month_end   SMALLINT,
  harvest_month_start SMALLINT,
  harvest_month_end   SMALLINT,
  notes           TEXT
);

-- ── 9. FARM CROP CYCLES ───────────────────────────────────────────────────────
CREATE TABLE crop_cycles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES field_zones(id),
  crop_id         UUID NOT NULL REFERENCES crops(id),
  -- Dates
  planted_at      DATE,
  expected_harvest DATE,
  actual_harvest  DATE,
  -- GDD tracking
  gdd_accumulated DECIMAL(8,2) DEFAULT 0,
  current_stage   growth_stage DEFAULT 'PRE_PLANTING',
  -- Outcomes
  actual_yield_t_ha DECIMAL(6,2),
  notes           TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. CROP RECOMMENDATIONS ──────────────────────────────────────────────────
CREATE TABLE crop_recommendations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES field_zones(id),
  generated_at    TIMESTAMPTZ DEFAULT NOW(),
  -- Input snapshot
  soil_inputs     JSONB NOT NULL,
  climate_inputs  JSONB NOT NULL,
  -- Recommendations (array of top 5)
  recommendations JSONB NOT NULL, -- [{crop_id, score, confidence, shap_drivers, shap_limiters, yield_est, revenue_est}]
  model_version   VARCHAR(20),
  is_acknowledged BOOLEAN DEFAULT FALSE
);

-- ── 11. GDD LOGS (TimescaleDB hypertable) ─────────────────────────────────────
CREATE TABLE gdd_logs (
  time            TIMESTAMPTZ NOT NULL,
  farm_id         UUID NOT NULL,
  zone_id         UUID,
  crop_cycle_id   UUID REFERENCES crop_cycles(id),
  tmax            DECIMAL(6,2),
  tmin            DECIMAL(6,2),
  gdd_daily       DECIMAL(6,2),
  gdd_cumulative  DECIMAL(8,2),
  growth_stage    growth_stage
);

SELECT create_hypertable('gdd_logs', 'time', chunk_time_interval => INTERVAL '30 days');

-- ── 12. WEATHER READINGS (TimescaleDB hypertable) ─────────────────────────────
CREATE TABLE weather_readings (
  time            TIMESTAMPTZ NOT NULL,
  farm_id         UUID NOT NULL,
  -- Current conditions
  temp_max        DECIMAL(6,2),
  temp_min        DECIMAL(6,2),
  temp_avg        DECIMAL(6,2),
  humidity_pct    DECIMAL(5,2),
  rainfall_mm     DECIMAL(8,2),
  wind_speed_kmh  DECIMAL(6,2),
  solar_radiation_mj DECIMAL(6,2),
  -- Source
  source          VARCHAR(50), -- 'sensor', 'openweather', 'tomorrowio'
  is_forecast     BOOLEAN DEFAULT FALSE
);

SELECT create_hypertable('weather_readings', 'time', chunk_time_interval => INTERVAL '30 days');

-- ── 13. ALERTS ────────────────────────────────────────────────────────────────
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  farm_id         UUID NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  zone_id         UUID REFERENCES field_zones(id),
  alert_type      alert_type NOT NULL,
  severity        alert_severity NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT NOT NULL,
  recommendation  TEXT,
  -- Trigger data
  trigger_value   DECIMAL(12,4),
  trigger_unit    VARCHAR(20),
  threshold_value DECIMAL(12,4),
  -- Status
  status          alert_status DEFAULT 'ACTIVE',
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  -- Delivery
  sms_sent        BOOLEAN DEFAULT FALSE,
  push_sent       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── 14. AUDIT LOG (immutable) ─────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  time            TIMESTAMPTZ DEFAULT NOW(),
  user_id         UUID REFERENCES users(id),
  farm_id         UUID,
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  old_value       JSONB,
  new_value       JSONB,
  ip_address      INET,
  user_agent      TEXT
);

-- ── INDEXES ───────────────────────────────────────────────────────────────────
CREATE INDEX idx_sensor_readings_node    ON sensor_readings(node_id, time DESC);
CREATE INDEX idx_sensor_readings_farm    ON sensor_readings(farm_id, time DESC);
CREATE INDEX idx_sensor_readings_type    ON sensor_readings(sensor_type, time DESC);
CREATE INDEX idx_gdd_logs_farm_time      ON gdd_logs(farm_id, time DESC);
CREATE INDEX idx_weather_farm_time       ON weather_readings(farm_id, time DESC);
CREATE INDEX idx_alerts_farm_status      ON alerts(farm_id, status);
CREATE INDEX idx_crop_cycles_farm_active ON crop_cycles(farm_id, is_active);
CREATE INDEX idx_sensor_nodes_farm       ON sensor_nodes(farm_id);
CREATE INDEX idx_farms_owner             ON farms(owner_id);

-- ── SEED: CROPS DATABASE ─────────────────────────────────────────────────────
INSERT INTO crops (name, scientific_name, category, season_type, gdd_base_temp, gdd_emergence, gdd_flowering, gdd_maturity, ph_min, ph_max, ph_optimal, n_requirement, p_requirement, k_requirement, min_temp_c, max_temp_c, min_rainfall_mm, max_rainfall_mm, avg_yield_t_ha, price_per_t_usd) VALUES
('Maize',     'Zea mays',             'Cereal',    'WARM', 10, 65,  775,  1450, 6.2, 6.8, 6.5, 'HIGH',   'MEDIUM', 'HIGH',   15, 35, 500,  800,  5.0,  220),
('Wheat',     'Triticum aestivum',    'Cereal',    'COOL', 0,  100, 1000, 1950, 6.0, 7.5, 6.5, 'HIGH',   'MEDIUM', 'MEDIUM', 5,  25, 450,  650,  3.5,  280),
('Rice',      'Oryza sativa',         'Cereal',    'WARM', 10, 85,  700,  1300, 5.5, 6.5, 6.0, 'HIGH',   'MEDIUM', 'HIGH',   18, 38, 1000, 2000, 4.5,  350),
('Soybeans',  'Glycine max',          'Legume',    'WARM', 10, 105, 800,  1450, 5.8, 7.0, 6.5, 'LOW',    'HIGH',   'MEDIUM', 15, 30, 450,  700,  2.5,  480),
('Tomatoes',  'Solanum lycopersicum', 'Vegetable', 'WARM', 10, 125, 900,  1550, 6.0, 6.8, 6.4, 'HIGH',   'HIGH',   'HIGH',   18, 32, 400,  600,  25.0, 600),
('Potatoes',  'Solanum tuberosum',    'Root',      'COOL', 7,  75,  600,  1200, 5.0, 6.0, 5.5, 'HIGH',   'HIGH',   'HIGH',   8,  22, 500,  700,  20.0, 300),
('Sorghum',   'Sorghum bicolor',      'Cereal',    'WARM', 10, 70,  675,  1150, 5.5, 7.5, 6.5, 'MEDIUM', 'LOW',    'MEDIUM', 12, 38, 350,  700,  3.0,  200),
('Cassava',   'Manihot esculenta',    'Root',      'WARM', 12, 150, NULL, 2700, 5.5, 7.0, 6.0, 'LOW',    'MEDIUM', 'HIGH',   18, 35, 500,  1500, 15.0, 180),
('Beans',     'Phaseolus vulgaris',   'Legume',    'WARM', 10, 90,  700,  1000, 6.0, 7.0, 6.5, 'LOW',    'HIGH',   'MEDIUM', 12, 28, 300,  500,  1.8,  700),
('Sunflower', 'Helianthus annuus',    'Oilseed',   'WARM', 10, 80,  850,  1200, 6.0, 7.5, 6.8, 'MEDIUM', 'MEDIUM', 'MEDIUM', 10, 32, 400,  700,  2.0,  500),
('Cabbage',   'Brassica oleracea',    'Vegetable', 'COOL', 5,  75,  600,  900,  6.0, 7.5, 6.5, 'HIGH',   'MEDIUM', 'HIGH',   4,  20, 380,  500,  30.0, 250),
('Lettuce',   'Lactuca sativa',       'Vegetable', 'COOL', 4,  60,  400,  750,  6.0, 7.0, 6.5, 'MEDIUM', 'LOW',    'MEDIUM', 4,  22, 300,  450,  15.0, 800);

-- Planting calendar — East Africa (EAF) overrides
INSERT INTO planting_calendar (crop_id, season_zone, season_label, plant_month_start, plant_month_end, harvest_month_start, harvest_month_end) VALUES
((SELECT id FROM crops WHERE name='Maize'),    'EAF', 'Long Rains',   3, 5,  8,  10),
((SELECT id FROM crops WHERE name='Maize'),    'EAF', 'Short Rains',  10,11, 1,  2),
((SELECT id FROM crops WHERE name='Beans'),    'EAF', 'Long Rains',   3, 5,  6,  8),
((SELECT id FROM crops WHERE name='Beans'),    'EAF', 'Short Rains',  10,11, 12, 1),
((SELECT id FROM crops WHERE name='Wheat'),    'EAF', 'Main Season',  10,11, 3,  4),
((SELECT id FROM crops WHERE name='Potatoes'), 'EAF', 'Long Rains',   3, 4,  6,  7),
((SELECT id FROM crops WHERE name='Tomatoes'), 'EAF', 'Dry Season',   6, 8,  9,  11),
((SELECT id FROM crops WHERE name='Sorghum'),  'EAF', 'Long Rains',   3, 5,  8,  10),
((SELECT id FROM crops WHERE name='Cassava'),  'EAF', 'Main Season',  3, 5,  NULL, NULL),
((SELECT id FROM crops WHERE name='Cabbage'),  'EAF', 'Dry Season',   6, 8,  10, 12);

COMMIT;
