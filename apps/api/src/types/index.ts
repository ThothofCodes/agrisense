/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

// ── Auth / User ───────────────────────────────────────────────────────────────
export type UserRole = 'ADMIN' | 'PROFESSIONAL' | 'FARMER' | 'BASIC';
export type SubscriptionTier = 'FREE' | 'FARMER' | 'PROFESSIONAL' | 'ENTERPRISE';

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  tier: SubscriptionTier;
  tier_expires_at?: string;
  language: string;
  timezone: string;
  mfa_enabled: boolean;
  last_login_at?: string;
  is_active: boolean;
  created_at: string;
  data_sharing_consent: boolean;
  consent_updated_at?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface JwtPayload {
  sub: string;       // user id
  email: string;
  role: UserRole;
  tier: SubscriptionTier;
  amr?: string[];    // Authentication Methods Reference — Clerk sets ["mfa"] when MFA was verified
  iat?: number;
  exp?: number;
}

// ── Farm ──────────────────────────────────────────────────────────────────────
export interface Farm {
  id: string;
  owner_id: string;
  name: string;
  description?: string;
  latitude: number;
  longitude: number;
  elevation_m?: number;
  county?: string;
  country: string;
  total_area_ha: number;
  rainfall_zone?: string;
  soil_type?: string;
  timezone: string;
  season_zone: string;
  is_active: boolean;
  created_at: string;
}

// ── Sensors ───────────────────────────────────────────────────────────────────
export type SensorType =
  | 'SOIL_PH' | 'SOIL_MOISTURE' | 'NITROGEN' | 'PHOSPHORUS' | 'POTASSIUM'
  | 'SOIL_TEMP' | 'ELECTRICAL_CONDUCTIVITY' | 'ORGANIC_MATTER'
  | 'AMBIENT_TEMP' | 'HUMIDITY' | 'RAINFALL' | 'SOLAR_RADIATION'
  | 'WIND_SPEED' | 'WIND_DIRECTION';

export type NodeStatus = 'ONLINE' | 'OFFLINE' | 'LOW_BATTERY' | 'CALIBRATION_DUE' | 'FAULT';

export interface SensorNode {
  id: string;
  farm_id: string;
  zone_id?: string;
  device_id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  depth_cm: number;
  firmware_version?: string;
  battery_pct?: number;
  solar_voltage?: number;
  status: NodeStatus;
  last_seen_at?: string;
  capabilities: SensorType[];
  created_at: string;
}

export interface SensorReading {
  time: string;
  node_id: string;
  farm_id: string;
  sensor_type: SensorType;
  value: number;
  unit: string;
  quality_score: number;
  is_anomaly: boolean;
}

// ── Soil Feasibility Score ────────────────────────────────────────────────────
export interface SFSComponents {
  ph_score:             number;
  nitrogen_score:       number;
  phosphorus_score:     number;
  potassium_score:      number;
  moisture_score:       number;
  organic_matter_score: number;
  ec_score:             number;
  soil_temp_score:      number;
}

export interface SFSResult extends SFSComponents {
  total_score:  number;
  interpretation: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  om_stale:     boolean;
  computed_at:  string;
}

// ── Crop / GDD ────────────────────────────────────────────────────────────────
export type GrowthStage =
  | 'PRE_PLANTING' | 'GERMINATION' | 'EMERGENCE' | 'VEGETATIVE'
  | 'TILLERING' | 'STEM_ELONGATION' | 'HEADING' | 'FLOWERING'
  | 'GRAIN_FILL' | 'MATURITY' | 'HARVEST' | 'POST_HARVEST';

export interface Crop {
  id: string;
  name: string;
  scientific_name?: string;
  category: string;
  season_type: string;
  gdd_base_temp: number;
  gdd_emergence?: number;
  gdd_flowering?: number;
  gdd_maturity: number;
  ph_min: number;
  ph_max: number;
  ph_optimal: number;
  min_temp_c: number;
  max_temp_c: number;
  avg_yield_t_ha: number;
  price_per_t_usd: number;
}

export interface GDDResult {
  gdd_daily:       number;
  gdd_cumulative:  number;
  current_stage:   GrowthStage;
  days_to_harvest: number | null;
  pct_complete:    number;
}

// ── Weather ───────────────────────────────────────────────────────────────────
export interface WeatherCurrent {
  temp_max:        number;
  temp_min:        number;
  temp_avg:        number;
  humidity_pct:    number;
  rainfall_mm:     number;
  wind_speed_kmh:  number;
  description:     string;
  icon:            string;
}

export interface WeatherForecast extends WeatherCurrent {
  date:           string;
  is_forecast:    boolean;
  low_confidence?: boolean;      // true when two+ weather sources disagree materially
  source_spread_pct?: number;    // % temp disagreement between sources, when known
}

// ── Alerts ────────────────────────────────────────────────────────────────────
export type AlertSeverity = 'ADVISORY' | 'WATCH' | 'WARNING' | 'CRITICAL';
export type AlertType =
  | 'FROST_WARNING' | 'DROUGHT_WATCH' | 'HEAVY_RAINFALL' | 'HEAT_STRESS'
  | 'HIGH_WIND' | 'PEST_RISK' | 'HAIL_PROBABILITY' | 'GDD_DEFICIT'
  | 'HARVEST_WINDOW' | 'SOIL_PH_DEVIATION' | 'NPK_DEFICIENCY'
  | 'SENSOR_OFFLINE' | 'ANOMALY_DETECTED';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED';

export interface Alert {
  id: string;
  farm_id: string;
  zone_id?: string;
  alert_type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  recommendation?: string;
  trigger_value?: number;
  trigger_unit?: string;
  threshold_value?: number;
  status: AlertStatus;
  created_at: string;
}

// ── Recommendations ───────────────────────────────────────────────────────────
export interface CropRecommendationItem {
  rank:         number;
  crop_id:      string;
  crop_name:    string;
  score:        number;
  confidence:   'HIGH' | 'MEDIUM' | 'LOW';
  shap_drivers: Array<{ factor: string; contribution: number }>;
  shap_limiters: Array<{ factor: string; impact: number }>;
  yield_est_t_ha: number;
  revenue_est_usd: number;
  explanation:   string;
}

// ── WebSocket Events ──────────────────────────────────────────────────────────
export type WsEventType =
  | 'SENSOR_UPDATE'
  | 'ALERT_FIRED'
  | 'GDD_TICK'
  | 'RECOMMENDATION_READY'
  | 'NODE_STATUS_CHANGE'
  | 'PING'
  | 'PONG';

export interface WsEvent {
  type:      WsEventType;
  farm_id:   string;
  payload:   any;
  timestamp: string;
}

// ── API Response wrappers ─────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, any>;
}

export interface ApiError {
  success: false;
  error: {
    code: string;     // AS-001 etc.
    message: string;
    details?: any;
  };
}

// ── Error Codes ───────────────────────────────────────────────────────────────
export const ErrorCodes = {
  // Auth
  INVALID_CREDENTIALS:   'AS-001',
  TOKEN_EXPIRED:         'AS-002',
  TOKEN_INVALID:         'AS-003',
  FORBIDDEN:             'AS-004',
  MFA_REQUIRED:          'AS-005',
  // Farm
  FARM_NOT_FOUND:        'AS-010',
  FARM_ACCESS_DENIED:    'AS-011',
  // Sensor
  NODE_NOT_FOUND:        'AS-020',
  NODE_ALREADY_EXISTS:   'AS-021',
  SENSOR_DATA_INVALID:   'AS-022',
  // ML
  ML_SERVICE_UNAVAILABLE:'AS-030',
  INSUFFICIENT_DATA:     'AS-031',
  // Weather
  WEATHER_API_ERROR:     'AS-040',
  // Payment
  PAYMENT_FAILED:        'AS-050',
  SUBSCRIPTION_EXPIRED:  'AS-051',
  // Consent
  CONSENT_REQUIRED:      'AS-060',
  // General
  VALIDATION_ERROR:      'AS-090',
  INTERNAL_ERROR:        'AS-099',
} as const;
