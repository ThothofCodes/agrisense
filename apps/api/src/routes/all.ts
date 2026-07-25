/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

// ── Weather Routes ────────────────────────────────────────────────────────────
import { Router } from 'express';
import { z } from 'zod';
import { dbQuery, dbQueryOne } from '../db';
import { authenticate, requireTier, requireMfa } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { weatherService } from '../services/weatherService';
import { alertService } from '../services/alertService';
import { mlService } from '../services/mlService';
import { paymentService } from '../services/paymentService';
import { ErrorCodes } from '../types';

export const weatherRouter = Router();
weatherRouter.use(authenticate);

weatherRouter.get('/:farmId/current', async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>('SELECT * FROM farms WHERE id=$1 AND owner_id=$2', [req.params.farmId, req.user!.sub]);
    if (!farm) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Farm not found');
    const weather = await weatherService.getCurrentWeather(farm.latitude, farm.longitude, farm.id);
    res.json({ success: true, data: { weather } });
  } catch (err) { next(err); }
});

weatherRouter.get('/:farmId/forecast', async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>('SELECT * FROM farms WHERE id=$1 AND owner_id=$2', [req.params.farmId, req.user!.sub]);
    if (!farm) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Farm not found');
    const days = Math.min(parseInt((req.query.days as string) || '7', 10), 14);
    const forecast = await weatherService.getForecast(farm.latitude, farm.longitude, farm.id, days);
    // Check for weather-based alerts
    await alertService.checkWeatherAlerts(farm.id, forecast).catch(() => {});
    res.json({ success: true, data: { forecast } });
  } catch (err) { next(err); }
});

weatherRouter.get('/:farmId/history', async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>('SELECT id FROM farms WHERE id=$1 AND owner_id=$2', [req.params.farmId, req.user!.sub]);
    if (!farm) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Farm not found');
    const days = Math.min(parseInt((req.query.days as string) || '30', 10), 365);
    const history = await weatherService.getHistoricalSummary(farm.id, days);
    res.json({ success: true, data: { history } });
  } catch (err) { next(err); }
});

// ── Crops Routes ───────────────────────────────────────────────────────────────
export const cropsRouter = Router();
cropsRouter.use(authenticate);

cropsRouter.get('/', async (req, res, next) => {
  try {
    const crops = await dbQuery('SELECT * FROM crops WHERE is_active=true ORDER BY name');
    res.json({ success: true, data: { crops } });
  } catch (err) { next(err); }
});

cropsRouter.get('/:id', async (req, res, next) => {
  try {
    const crop = await dbQueryOne('SELECT * FROM crops WHERE id=$1', [req.params.id]);
    if (!crop) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Crop not found');
    res.json({ success: true, data: { crop } });
  } catch (err) { next(err); }
});

cropsRouter.get('/calendar/:zone', async (req, res, next) => {
  try {
    const calendar = await dbQuery(
      `SELECT pc.*, c.name AS crop_name, c.category, c.season_type,
              c.gdd_maturity, c.ph_min, c.ph_max, c.avg_yield_t_ha
       FROM planting_calendar pc JOIN crops c ON c.id=pc.crop_id
       WHERE pc.season_zone=$1 ORDER BY pc.plant_month_start`,
      [req.params.zone]
    );
    res.json({ success: true, data: { calendar } });
  } catch (err) { next(err); }
});

// ── Crop Cycles Routes ─────────────────────────────────────────────────────────
export const cyclesRouter = Router();
cyclesRouter.use(authenticate);

cyclesRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    const cycles = await dbQuery(
      `SELECT cc.*, c.name AS crop_name, c.gdd_base_temp, c.gdd_maturity, c.avg_yield_t_ha
       FROM crop_cycles cc JOIN crops c ON c.id=cc.crop_id
       WHERE cc.farm_id=$1 ORDER BY cc.created_at DESC`,
      [farm_id]
    );
    res.json({ success: true, data: { cycles } });
  } catch (err) { next(err); }
});

cyclesRouter.post('/', async (req, res, next) => {
  try {
    const { farm_id, zone_id, crop_id, planted_at, expected_harvest } = req.body;
    const farm = await dbQueryOne<any>('SELECT id FROM farms WHERE id=$1 AND owner_id=$2', [farm_id, req.user!.sub]);
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');
    const [cycle] = await dbQuery(
      `INSERT INTO crop_cycles (farm_id, zone_id, crop_id, planted_at, expected_harvest)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [farm_id, zone_id || null, crop_id, planted_at || null, expected_harvest || null]
    );
    res.status(201).json({ success: true, data: { cycle } });
  } catch (err) { next(err); }
});

cyclesRouter.get('/:id/gdd', async (req, res, next) => {
  try {
    const cycle = await dbQueryOne<any>(
      `SELECT cc.*, c.gdd_base_temp, c.gdd_maturity, c.gdd_emergence, c.gdd_flowering,
              c.name AS crop_name, c.typical_days_to_maturity
       FROM crop_cycles cc JOIN crops c ON c.id=cc.crop_id WHERE cc.id=$1`,
      [req.params.id]
    );
    if (!cycle) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Cycle not found');

    // Latest weather for GDD computation
    const [weather] = await dbQuery(
      'SELECT temp_max, temp_min FROM weather_readings WHERE farm_id=$1 ORDER BY time DESC LIMIT 1',
      [cycle.farm_id]
    );

    const gdd = await mlService.computeGDD({
      tmax:           weather?.temp_max ?? 25,
      tmin:           weather?.temp_min ?? 15,
      base_temp:      cycle.gdd_base_temp,
      gdd_cumulative: parseFloat(cycle.gdd_accumulated),
      gdd_emergence:  cycle.gdd_emergence,
      gdd_flowering:  cycle.gdd_flowering,
      gdd_maturity:   cycle.gdd_maturity,
      planted_at:     cycle.planted_at,
    });

    // Update accumulated GDD
    await dbQuery(
      'UPDATE crop_cycles SET gdd_accumulated=$1, current_stage=$2, updated_at=NOW() WHERE id=$3',
      [gdd.gdd_cumulative, gdd.current_stage, cycle.id]
    );

    // Proactive deficit check — "stop problems before they impact yield"
    // (Climate FieldView design philosophy). Fire-and-forget; never block
    // the GDD response on alert-engine latency.
    if (cycle.planted_at) {
      alertService.checkGddDeficit({
        farmId: cycle.farm_id, cropCycleId: cycle.id, cropName: cycle.crop_name,
        plantedAt: cycle.planted_at, gddAccumulated: gdd.gdd_cumulative,
        gddMaturity: cycle.gdd_maturity, typicalDaysToMaturity: cycle.typical_days_to_maturity,
      }).catch(() => {});
    }

    res.json({ success: true, data: { gdd, crop: cycle.crop_name, cycle_id: cycle.id } });
  } catch (err) { next(err); }
});

// ── Alerts Routes ─────────────────────────────────────────────────────────────
export const alertsRouter = Router();
alertsRouter.use(authenticate);

alertsRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id, status } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    const farm = await dbQueryOne<any>('SELECT id FROM farms WHERE id=$1 AND owner_id=$2', [farm_id, req.user!.sub]);
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');
    const alerts = await alertService.getAlerts(farm_id as string, status as string);
    res.json({ success: true, data: { alerts } });
  } catch (err) { next(err); }
});

alertsRouter.patch('/:id/acknowledge', async (req, res, next) => {
  try {
    const [alert] = await alertService.acknowledge(req.params.id, req.user!.sub);
    res.json({ success: true, data: { alert } });
  } catch (err) { next(err); }
});

alertsRouter.patch('/:id/dismiss', async (req, res, next) => {
  try {
    const [alert] = await dbQuery(
      `UPDATE alerts SET status='DISMISSED', updated_at=NOW() WHERE id=$1 RETURNING *`,
      [req.params.id]
    );
    res.json({ success: true, data: { alert } });
  } catch (err) { next(err); }
});

// ── Recommendations Routes ─────────────────────────────────────────────────────
export const recommendationsRouter = Router();
recommendationsRouter.use(authenticate);

const SOIL_PARAMS_REQUIRED = ['soil_ph','nitrogen','phosphorus','potassium','soil_moisture','electrical_conductivity','organic_matter','soil_temp'];
const CONFIDENCE_RANK: Record<string, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

recommendationsRouter.post('/crops', requireTier('FARMER', 'PROFESSIONAL', 'ENTERPRISE'), async (req, res, next) => {
  try {
    const { farm_id, zone_id } = req.body;
    const farm = await dbQueryOne<any>('SELECT * FROM farms WHERE id=$1 AND owner_id=$2', [farm_id, req.user!.sub]);
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');

    // Gather latest sensor readings for this farm, joined to the node that
    // produced them so we know how much to trust each value.
    const sensorData = await dbQuery(
      `SELECT DISTINCT ON (sr.sensor_type) sr.sensor_type, sr.value, sr.time, sn.trust_score
       FROM sensor_readings sr JOIN sensor_nodes sn ON sn.id = sr.node_id
       WHERE sr.farm_id=$1 AND sr.time > NOW()-INTERVAL '24 hours'
       ORDER BY sr.sensor_type, sr.time DESC`,
      [farm_id]
    );
    const sensorMap = Object.fromEntries(sensorData.map((r: any) => [r.sensor_type.toLowerCase(), parseFloat(r.value)]));

    // ── Food-security guardrail: quantify how much of this recommendation is
    // real farm data vs. generic defaults, and how reliable the contributing
    // sensors are. A recommendation built mostly on placeholder values must
    // never present itself with the same authority as one built on fresh,
    // trustworthy readings. ──────────────────────────────────────────────────
    const paramsPresent = SOIL_PARAMS_REQUIRED.filter(p => sensorMap[p] !== undefined).length;
    const dataCompletenessPct = Math.round((paramsPresent / SOIL_PARAMS_REQUIRED.length) * 100);
    const trustScores = sensorData.map((r: any) => r.trust_score).filter((t: any) => t !== null);
    const avgTrustScore = trustScores.length ? Math.round(trustScores.reduce((a: number, b: number) => a + b, 0) / trustScores.length) : 100;
    const effectiveConfidencePct = Math.min(dataCompletenessPct, avgTrustScore);
    const requiresAgronomistReview = effectiveConfidencePct < 60 || paramsPresent === 0;

    // Latest weather
    const [weather] = await dbQuery(
      'SELECT temp_avg, rainfall_mm, humidity_pct FROM weather_readings WHERE farm_id=$1 ORDER BY time DESC LIMIT 1',
      [farm_id]
    );

    const inputs = {
      soil: {
        ph:       sensorMap['soil_ph'] ?? 6.5,
        nitrogen: sensorMap['nitrogen'] ?? 20,
        phosphorus: sensorMap['phosphorus'] ?? 12,
        potassium:  sensorMap['potassium'] ?? 120,
        moisture:   sensorMap['soil_moisture'] ?? 60,
        ec:         sensorMap['electrical_conductivity'] ?? 0.5,
        organic_matter: sensorMap['organic_matter'] ?? 2.5,
        soil_temp:  sensorMap['soil_temp'] ?? 20,
      },
      climate: {
        temp_avg:     weather?.temp_avg ?? 22,
        rainfall_mm:  weather?.rainfall_mm ?? 400,
        humidity_pct: weather?.humidity_pct ?? 60,
        elevation_m:  farm.elevation_m ?? 1200,
      },
      farm_context: {
        area_ha:      farm.total_area_ha,
        season_zone:  farm.season_zone,
        latitude:     farm.latitude,
        longitude:    farm.longitude,
        market_access: 'MEDIUM',
      },
    };

    const rawRecommendations = await mlService.getCropRecommendations(inputs);

    // Downgrade each crop's confidence to reflect data quality — a model
    // score of 92 means nothing if it was computed from 8 default values.
    // We never raise confidence above what the ML layer assigned; we only
    // ever pull it down to match the weaker of (data completeness, sensor
    // trust). This is a strict ceiling, not an average.
    const confidenceCeiling = effectiveConfidencePct >= 80 ? 'HIGH' : effectiveConfidencePct >= 60 ? 'MEDIUM' : 'LOW';
    const recommendations = rawRecommendations.map((r: any) => {
      const finalConfidence = CONFIDENCE_RANK[confidenceCeiling] < CONFIDENCE_RANK[r.confidence] ? confidenceCeiling : r.confidence;
      return {
        ...r,
        confidence: finalConfidence,
        explanation: requiresAgronomistReview
          ? `${r.explanation} ⚠️ Based on incomplete field data (${dataCompletenessPct}% of soil parameters available) — treat as a starting point, not a final decision.`
          : r.explanation,
      };
    });

    const [stored] = await dbQuery(
      `INSERT INTO crop_recommendations (farm_id, zone_id, soil_inputs, climate_inputs, recommendations, data_completeness_pct, requires_agronomist_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, generated_at`,
      [farm_id, zone_id || null, JSON.stringify(inputs.soil), JSON.stringify(inputs.climate),
       JSON.stringify(recommendations), dataCompletenessPct, requiresAgronomistReview]
    );

    res.json({
      success: true,
      data: {
        recommendations, recommendation_id: stored.id, generated_at: stored.generated_at,
        data_completeness_pct: dataCompletenessPct,
        avg_sensor_trust_score: avgTrustScore,
        requires_agronomist_review: requiresAgronomistReview,
      }
    });
  } catch (err) { next(err); }
});

recommendationsRouter.get('/crops/history/:farmId', authenticate, async (req, res, next) => {
  try {
    const recs = await dbQuery(
      'SELECT id, generated_at, recommendations FROM crop_recommendations WHERE farm_id=$1 ORDER BY generated_at DESC LIMIT 10',
      [req.params.farmId]
    );
    res.json({ success: true, data: { history: recs } });
  } catch (err) { next(err); }
});

// ── SFS Route ─────────────────────────────────────────────────────────────────
export const sfsRouter = Router();
sfsRouter.use(authenticate);

sfsRouter.get('/:farmId', async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>('SELECT id FROM farms WHERE id=$1 AND owner_id=$2', [req.params.farmId, req.user!.sub]);
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');

    const sensorData = await dbQuery(
      `SELECT DISTINCT ON (sr.sensor_type) sr.sensor_type, sr.value, sr.time, sn.trust_score, sn.id AS node_id
       FROM sensor_readings sr JOIN sensor_nodes sn ON sn.id = sr.node_id
       WHERE sr.farm_id=$1 AND sr.time > NOW()-INTERVAL '24 hours'
       ORDER BY sr.sensor_type, sr.time DESC`,
      [req.params.farmId]
    );
    const sensorMap = Object.fromEntries(sensorData.map((r: any) => [r.sensor_type.toLowerCase(), { value: parseFloat(r.value), time: r.time, trust_score: r.trust_score }]));

    const omAge = sensorMap['organic_matter']?.time
      ? (Date.now() - new Date(sensorMap['organic_matter'].time).getTime()) / 86400000
      : 9999;
    const omStale = omAge > 90;

    const paramsPresent = SOIL_PARAMS_REQUIRED.filter(p => sensorMap[p] !== undefined).length;
    const dataCompletenessPct = Math.round((paramsPresent / SOIL_PARAMS_REQUIRED.length) * 100);
    const trustScores = Object.values(sensorMap).map((v: any) => v.trust_score).filter((t: any) => t != null);
    const avgTrustScore = trustScores.length ? Math.round(trustScores.reduce((a: number, b: number) => a + b, 0) / trustScores.length) : 100;
    const effectiveConfidencePct = Math.min(dataCompletenessPct, avgTrustScore);

    const sfs = await mlService.computeSFS({
      ph:       sensorMap['soil_ph']?.value ?? 6.5,
      nitrogen: sensorMap['nitrogen']?.value ?? 20,
      phosphorus: sensorMap['phosphorus']?.value ?? 12,
      potassium:  sensorMap['potassium']?.value ?? 120,
      moisture:   sensorMap['soil_moisture']?.value ?? 60,
      ec:         sensorMap['electrical_conductivity']?.value ?? 0.5,
      organic_matter: sensorMap['organic_matter']?.value ?? 2.5,
      soil_temp:  sensorMap['soil_temp']?.value ?? 20,
    });

    // A score is only as good as the sensors that fed it. If a contributing
    // node's calibration has drifted (low trust_score) or coverage is thin,
    // the interpretation banner is capped one tier below what the raw number
    // would otherwise claim — "EXCELLENT" soil should never be reported from
    // mostly-default inputs or a sensor that's six months out of calibration.
    const TIERS: Array<'POOR'|'FAIR'|'GOOD'|'EXCELLENT'> = ['POOR', 'FAIR', 'GOOD', 'EXCELLENT'];
    let interpretation: 'POOR'|'FAIR'|'GOOD'|'EXCELLENT' = sfs.interpretation;
    if (effectiveConfidencePct < 60) {
      const idx = Math.max(0, TIERS.indexOf(interpretation) - 1);
      interpretation = TIERS[idx];
    }

    // Persist score (completeness/trust folded into the inputs snapshot —
    // no schema change needed for this audit trail).
    await dbQuery(
      `INSERT INTO soil_feasibility_scores (farm_id, total_score, ph_score, nitrogen_score, phosphorus_score,
         potassium_score, moisture_score, organic_matter_score, ec_score, soil_temp_score, om_stale, inputs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [req.params.farmId, sfs.total_score, sfs.ph_score, sfs.nitrogen_score, sfs.phosphorus_score,
       sfs.potassium_score, sfs.moisture_score, sfs.organic_matter_score, sfs.ec_score,
       sfs.soil_temp_score, omStale, JSON.stringify({ ...sensorMap, data_completeness_pct: dataCompletenessPct, avg_trust_score: avgTrustScore })]
    ).catch(() => {});

    res.json({
      success: true,
      data: {
        sfs: { ...sfs, interpretation, om_stale: omStale },
        data_completeness_pct: dataCompletenessPct,
        avg_sensor_trust_score: avgTrustScore,
      }
    });
  } catch (err) { next(err); }
});

// ── Quick Soil Check — manual entry (UjuziKilimo competitive response) ──────
// See infrastructure/postgres/003_quick_soil_check.sql for the full context:
// UjuziKilimo's SoilPal Pro is a handheld smartphone-connected spectrometer —
// a farmer can get a real soil reading without ever provisioning AgriSense's
// fixed IoT hardware. This endpoint closes that adoption-barrier gap: any
// farmer can type in readings from ANY source (a SoilPal, a county lab, a
// test strip) and get the exact same SFS computation and downstream crop
// recommendation a sensor-fed farm gets. Manually-entered data gets a fixed,
// conservative trust score (70) rather than the IoT calibration/anomaly-
// derived trust_score — it's real data, just not independently verified the
// way a calibrated, continuously-monitored sensor is.
const MANUAL_ENTRY_TRUST_SCORE = 70;

const manualSfsSchema = z.object({
  ph:             z.number().min(0).max(14),
  nitrogen:       z.number().min(0).max(500),
  phosphorus:     z.number().min(0).max(300),
  potassium:      z.number().min(0).max(1000),
  moisture:       z.number().min(0).max(100),
  ec:             z.number().min(0).max(20),
  organic_matter: z.number().min(0).max(100),
  soil_temp:      z.number().min(-10).max(60),
  notes:          z.string().max(500).optional(),
});

sfsRouter.post('/:farmId/manual', async (req, res, next) => {
  try {
    const farm = await dbQueryOne<any>('SELECT id FROM farms WHERE id=$1 AND owner_id=$2', [req.params.farmId, req.user!.sub]);
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm access denied');

    const body = manualSfsSchema.parse(req.body);

    const sfs = await mlService.computeSFS({
      ph: body.ph, nitrogen: body.nitrogen, phosphorus: body.phosphorus,
      potassium: body.potassium, moisture: body.moisture, ec: body.ec,
      organic_matter: body.organic_matter, soil_temp: body.soil_temp,
    });

    // Manual entries always have 100% "completeness" (the farmer typed in
    // all 8 parameters) but are capped at the fixed conservative trust score
    // — same effective-confidence-ceiling logic as the sensor pathway, so a
    // manual entry can never present itself with more authority than a
    // freshly-calibrated sensor would.
    const TIERS: Array<'POOR'|'FAIR'|'GOOD'|'EXCELLENT'> = ['POOR', 'FAIR', 'GOOD', 'EXCELLENT'];
    let interpretation: 'POOR'|'FAIR'|'GOOD'|'EXCELLENT' = sfs.interpretation;
    if (MANUAL_ENTRY_TRUST_SCORE < 60) {
      const idx = Math.max(0, TIERS.indexOf(interpretation) - 1);
      interpretation = TIERS[idx];
    }

    const [stored] = await dbQuery(
      `INSERT INTO soil_feasibility_scores (farm_id, total_score, ph_score, nitrogen_score, phosphorus_score,
         potassium_score, moisture_score, organic_matter_score, ec_score, soil_temp_score, om_stale, inputs,
         source, entered_by, entry_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'MANUAL',$13,$14) RETURNING id, computed_at`,
      [req.params.farmId, sfs.total_score, sfs.ph_score, sfs.nitrogen_score, sfs.phosphorus_score,
       sfs.potassium_score, sfs.moisture_score, sfs.organic_matter_score, sfs.ec_score, sfs.soil_temp_score,
       false, JSON.stringify(body), req.user!.sub, body.notes ?? null]
    );

    res.status(201).json({
      success: true,
      data: {
        sfs: { ...sfs, interpretation, om_stale: false },
        source: 'MANUAL',
        data_completeness_pct: 100,
        avg_sensor_trust_score: MANUAL_ENTRY_TRUST_SCORE,
        score_id: stored.id,
        computed_at: stored.computed_at,
      }
    });
  } catch (err) { next(err); }
});

// ── Payments Routes ────────────────────────────────────────────────────────────
export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

paymentsRouter.post('/subscribe', requireMfa(), async (req, res, next) => {
  try {
    const { tier, phone } = req.body;
    if (!['FARMER', 'PROFESSIONAL'].includes(tier)) {
      throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'Invalid tier');
    }
    const amount = paymentService.getTierPrice(tier);
    const result = await paymentService.initiateSTKPush({
      phoneNumber: phone,
      amount,
      accountRef:  `AGS-${req.user!.sub.slice(0, 8).toUpperCase()}`,
      description: `AgriSense ${tier} Subscription`,
      userId:      req.user!.sub,
      tier,
    });
    res.json({ success: true, data: { ...result, amount_kes: amount, tier } });
  } catch (err) { next(err); }
});

paymentsRouter.post('/mpesa/callback', async (req, res, next) => {
  try {
    await paymentService.handleCallback(req.body);
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) { next(err); }
});
