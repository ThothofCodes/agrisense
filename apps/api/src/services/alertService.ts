/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { dbQuery, dbQueryOne } from '../db';
import { AlertType, AlertSeverity, SensorType } from '../types';
import { smsService } from './smsService';
import { wsBroadcast } from './wsService';
import { logger } from '../utils/logger';

// ── Sensor thresholds (audit fix: covers all 8 parameters) ──────────────────
const THRESHOLDS: Record<SensorType, { low?: number; high?: number; unit: string }> = {
  SOIL_PH:                { low: 5.5,  high: 8.0,  unit: 'pH'    },
  SOIL_MOISTURE:          { low: 30,   high: 95,   unit: '%FC'   },
  NITROGEN:               { low: 15,                unit: 'mg/kg' },
  PHOSPHORUS:             { low: 8,                 unit: 'mg/kg' },
  POTASSIUM:              { low: 80,                unit: 'mg/kg' },
  SOIL_TEMP:              { low: 5,    high: 40,   unit: '°C'    },
  ELECTRICAL_CONDUCTIVITY:{ high: 2.0,              unit: 'dS/m'  },
  ORGANIC_MATTER:         { low: 1.5,               unit: '%'     },
  AMBIENT_TEMP:           { low: 0,    high: 42,   unit: '°C'    },
  HUMIDITY:               { low: 20,   high: 98,   unit: '%'     },
  RAINFALL:               { high: 50,               unit: 'mm'    },
  SOLAR_RADIATION:        {                         unit: 'MJ/m²' },
  WIND_SPEED:             { high: 60,               unit: 'km/h'  },
  WIND_DIRECTION:         {                         unit: '°'     },
};

const SENSOR_ALERT_MAP: Partial<Record<SensorType, { type: AlertType; severity: AlertSeverity; title: string; message: (v: number, thresh: number) => string; recommendation: string }[]>> = {
  SOIL_PH: [
    { type: 'SOIL_PH_DEVIATION', severity: 'WARNING', title: 'Soil pH Too Low',
      message: (v, t) => `Soil pH reading of ${v} is critically acidic (threshold: ${t}). Nutrient lockup likely.`,
      recommendation: 'Apply calcitic or dolomitic lime. Target application rate: 2–4 t/ha. Retest in 4 weeks.' },
    { type: 'SOIL_PH_DEVIATION', severity: 'WARNING', title: 'Soil pH Too High',
      message: (v, t) => `Soil pH reading of ${v} is alkaline (threshold: ${t}). Iron and zinc deficiency risk.`,
      recommendation: 'Apply elemental sulphur at 0.5–2 t/ha. Consider ammonium-based nitrogen fertilisers.' },
  ],
  SOIL_MOISTURE: [
    { type: 'DROUGHT_WATCH', severity: 'WATCH', title: 'Low Soil Moisture — Drought Risk',
      message: (v, t) => `Soil moisture at ${v}% FC (threshold: ${t}%). Crop stress imminent.`,
      recommendation: 'Activate supplementary irrigation immediately. Target 60–80% field capacity.' },
  ],
  NITROGEN: [
    { type: 'NPK_DEFICIENCY', severity: 'ADVISORY', title: 'Nitrogen Deficiency Detected',
      message: (v, t) => `Soil nitrogen at ${v} mg/kg (threshold: ${t} mg/kg). Yellowing may be visible.`,
      recommendation: 'Apply urea (46% N) at 50–100 kg/ha or CAN at 150 kg/ha. Incorporate before rain.' },
  ],
  PHOSPHORUS: [
    { type: 'NPK_DEFICIENCY', severity: 'ADVISORY', title: 'Phosphorus Deficiency Detected',
      message: (v, t) => `Soil phosphorus at ${v} mg/kg (threshold: ${t} mg/kg). Root development at risk.`,
      recommendation: 'Apply DAP at 50 kg/ha or TSP at 40 kg/ha. Ensure pH > 5.5 for maximum availability.' },
  ],
  POTASSIUM: [
    { type: 'NPK_DEFICIENCY', severity: 'ADVISORY', title: 'Potassium Deficiency Detected',
      message: (v, t) => `Soil potassium at ${v} mg/kg (threshold: ${t} mg/kg). Yield quality at risk.`,
      recommendation: 'Apply MOP (muriate of potash) at 50–80 kg/ha. Split application recommended.' },
  ],
  ELECTRICAL_CONDUCTIVITY: [
    { type: 'SOIL_PH_DEVIATION', severity: 'WATCH', title: 'High Soil Salinity',
      message: (v, t) => `EC at ${v} dS/m (threshold: ${t} dS/m). Salt stress may reduce germination.`,
      recommendation: 'Flush with clean water. Consider salt-tolerant crop varieties. Improve drainage.' },
  ],
  WIND_SPEED: [
    { type: 'HIGH_WIND', severity: 'ADVISORY', title: 'High Wind Speed Alert',
      message: (v, t) => `Wind speed at ${v} km/h exceeds ${t} km/h threshold.`,
      recommendation: 'Delay spray operations. Secure greenhouse covers and irrigation equipment.' },
  ],
};

export const alertService = {
  // nodeId is part of the signature for future per-node alert tracking, but
  // dedup is deliberately farm-level: if 3 sensors on one farm all read bad
  // pH, that should be ONE actionable alert, not 3 — spamming a farmer with
  // duplicate alerts trains them to ignore the alert centre entirely.
  async checkSensorReading(farmId: string, sensorType: SensorType, value: number, _nodeId: string): Promise<void> {
    const thresh = THRESHOLDS[sensorType];
    if (!thresh) return;
    const defs = SENSOR_ALERT_MAP[sensorType];
    if (!defs) return;

    for (const def of defs) {
      let triggered = false;
      let thresholdValue = 0;
      if (thresh.low !== undefined && value < thresh.low && def.message.toString().includes('Low')) {
        triggered = true; thresholdValue = thresh.low;
      }
      if (thresh.high !== undefined && value > thresh.high && !def.message.toString().includes('Low')) {
        triggered = true; thresholdValue = thresh.high;
      }
      if (!triggered) continue;

      // Deduplicate: don't re-fire same alert type within 6 hours
      const existing = await dbQueryOne(
        `SELECT id FROM alerts WHERE farm_id=$1 AND alert_type=$2 AND status='ACTIVE'
         AND created_at > NOW() - INTERVAL '6 hours'`,
        [farmId, def.type]
      );
      if (existing) continue;

      const [alert] = await dbQuery(
        `INSERT INTO alerts (farm_id, alert_type, severity, title, message, recommendation, trigger_value, trigger_unit, threshold_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [farmId, def.type, def.severity, def.title, def.message(value, thresholdValue), def.recommendation, value, thresh.unit, thresholdValue]
      );

      // WebSocket push
      wsBroadcast(farmId, 'ALERT_FIRED', alert);

      // SMS for WARNING and WATCH severity
      if (['WARNING', 'WATCH'].includes(def.severity)) {
        await smsService.sendFarmAlert(farmId, def.title, def.recommendation).catch(e =>
          logger.warn('SMS alert failed', { error: e.message })
        );
      }
      logger.info('Alert fired', { farmId, type: def.type, severity: def.severity });
    }
  },

  /**
   * Proactive GDD-deficit detection — Climate FieldView's stated design
   * philosophy is "stop problems before they impact yield" rather than
   * reacting after the fact. v2.0 declared the GDD_DEFICIT alert type but
   * never implemented a baseline to compare against, so it could never
   * actually fire. This closes that gap: expected GDD at day N is modelled
   * as a straight-line fraction of typical_days_to_maturity, and a cycle
   * running materially behind that pace is flagged while there's still time
   * to act (replant, adjust variety, irrigate to accelerate growth).
   */
  async checkGddDeficit(params: {
    farmId: string; cropCycleId: string; cropName: string;
    plantedAt: string; gddAccumulated: number; gddMaturity: number;
    typicalDaysToMaturity: number;
  }): Promise<void> {
    const { farmId, cropName, plantedAt, gddAccumulated, gddMaturity, typicalDaysToMaturity } = params;
    if (!plantedAt || !typicalDaysToMaturity) return;

    const daysElapsed = Math.max(1, Math.floor((Date.now() - new Date(plantedAt).getTime()) / 86400000));
    if (daysElapsed >= typicalDaysToMaturity) return; // past expected maturity — different alert territory

    const expectedFraction = Math.min(1, daysElapsed / typicalDaysToMaturity);
    const expectedGdd = gddMaturity * expectedFraction;
    if (expectedGdd <= 0) return;

    const deficitPct = ((expectedGdd - gddAccumulated) / expectedGdd) * 100;

    // Only alert on a material, sustained deficit — not day-to-day noise.
    if (deficitPct > 15) {
      await this.createIfNotExists(farmId, 'GDD_DEFICIT', deficitPct > 30 ? 'WATCH' : 'ADVISORY',
        `${cropName} Growth Running Behind Schedule`,
        `At day ${daysElapsed}, accumulated GDD is ${gddAccumulated.toFixed(0)} vs an expected ${expectedGdd.toFixed(0)} for this point in the season — a ${deficitPct.toFixed(0)}% deficit.`,
        deficitPct > 30
          ? 'Significant delay. Review soil temperature and moisture — cold or dry soil slows heat-unit accumulation. Consider whether harvest timing or variety choice needs revisiting this season.'
          : 'Minor delay, likely recoverable. Monitor over the next week; ensure soil moisture is not limiting growth.',
        deficitPct, '%', 15);
    }
  },

  async checkWeatherAlerts(farmId: string, forecast: any[]): Promise<void> {
    for (const day of forecast) {
      const date = day.date;

      // Insight from the ensemble cross-validation: when two reputable
      // forecast sources disagree materially, that uncertainty is itself
      // worth surfacing — silently averaging it away would hide a real
      // planning risk (e.g. "will it frost tonight or not?").
      if (day.low_confidence) {
        await this.createIfNotExists(farmId, 'ANOMALY_DETECTED', 'ADVISORY',
          `Forecast Uncertainty — ${date}`,
          `Weather sources disagree on conditions for ${date} (~${day.source_spread_pct ?? '?'}% spread on temperature). Treat this day's forecast as indicative, not precise.`,
          'Re-check the forecast closer to the date. Avoid timing irreversible actions (e.g. one-shot fungicide spray) purely off this day.',
          day.source_spread_pct, '%', 3);
      }

      if (day.temp_min < 5) {
        await this.createIfNotExists(farmId, 'FROST_WARNING', 'WARNING',
          `Frost Risk — ${date}`,
          `Minimum temperature forecast of ${day.temp_min}°C on ${date}. Below crop safe threshold.`,
          'Cover frost-sensitive crops. Delay planting tender seedlings. Monitor overnight.',
          day.temp_min, '°C', 5);
      }
      if (day.rainfall_mm > 50) {
        await this.createIfNotExists(farmId, 'HEAVY_RAINFALL', 'WATCH',
          `Heavy Rainfall Forecast — ${date}`,
          `${day.rainfall_mm}mm of rainfall expected on ${date}. Risk of waterlogging and soil erosion.`,
          'Ensure drainage channels are clear. Delay field operations and spray programs.',
          day.rainfall_mm, 'mm', 50);
      }
      if (day.temp_max > 38) {
        await this.createIfNotExists(farmId, 'HEAT_STRESS', 'WARNING',
          `Heat Stress Alert — ${date}`,
          `Maximum temperature of ${day.temp_max}°C forecast. Exceeds critical crop threshold.`,
          'Apply irrigation during evening hours. Consider shade netting for horticulture crops.',
          day.temp_max, '°C', 38);
      }
      if (day.wind_speed_kmh > 60) {
        await this.createIfNotExists(farmId, 'HIGH_WIND', 'ADVISORY',
          `High Wind Speed — ${date}`,
          `Wind gusts of ${day.wind_speed_kmh} km/h expected. Risk of crop lodging and damage.`,
          'Secure greenhouse infrastructure. Postpone spray operations.',
          day.wind_speed_kmh, 'km/h', 60);
      }
    }
  },

  async createIfNotExists(farmId: string, type: AlertType, severity: AlertSeverity, title: string, message: string, recommendation: string, triggerValue?: number, triggerUnit?: string, thresholdValue?: number) {
    const existing = await dbQueryOne(
      `SELECT id FROM alerts WHERE farm_id=$1 AND alert_type=$2 AND status='ACTIVE' AND created_at > NOW() - INTERVAL '12 hours'`,
      [farmId, type]
    );
    if (existing) return;
    const [alert] = await dbQuery(
      `INSERT INTO alerts (farm_id, alert_type, severity, title, message, recommendation, trigger_value, trigger_unit, threshold_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [farmId, type, severity, title, message, recommendation, triggerValue, triggerUnit, thresholdValue]
    );
    wsBroadcast(farmId, 'ALERT_FIRED', alert);
  },

  async getAlerts(farmId: string, status?: string) {
    const params: any[] = [farmId];
    let q = 'SELECT * FROM alerts WHERE farm_id = $1';
    if (status) { params.push(status); q += ` AND status = $${params.length}`; }
    q += ' ORDER BY created_at DESC LIMIT 100';
    return dbQuery(q, params);
  },

  async acknowledge(alertId: string, userId: string) {
    return dbQuery(
      `UPDATE alerts SET status='ACKNOWLEDGED', acknowledged_by=$1, acknowledged_at=NOW() WHERE id=$2 RETURNING *`,
      [userId, alertId]
    );
  },
};
