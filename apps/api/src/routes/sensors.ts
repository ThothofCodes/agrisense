/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { dbQuery, dbQueryOne } from '../db';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { SensorNode, SensorReading, SensorType, ErrorCodes } from '../types';
import { mlService } from '../services/mlService';
import { alertService } from '../services/alertService';
import { wsBroadcast } from '../services/wsService';

export const sensorsRouter = Router();
sensorsRouter.use(authenticate);

// ── Sensor-ingestion rate limit — keyed by device, not IP ──────────────────
// FOUND VIA HARDWARE SIMULATION (June 2026): the original IoT limiter was
// applied to the *entire* /sensors router, keyed by raw IP, at 10 req/min.
// A load-test simulating multiple farms immediately collapsed under 429s —
// not because of any real abuse, but because every simulated client shared
// one IP. That's not a sandbox artefact: it's exactly Ruai Tech Solutions'
// real deployment context — multiple farms/sensor gateways behind a single
// rural NAT'd router will share one public IP in production too.
//
// Fixed two ways:
//  1. Scoped to ONLY the actual high-frequency ingestion route — dashboard
//     reads and node registration are infrequent and stay under the general
//     apiLimiter (100/min/IP) instead of competing for this budget.
//  2. Keyed by node_id (the device), not IP — so N farms behind one NAT'd
//     IP each get their own ingestion budget, matching how the blueprint's
//     "72h local buffering" design means a single recovering node can
//     legitimately burst many queued readings at once without that burst
//     being capped by every OTHER device sharing the same public IP.
const ingestionLimiter = rateLimit({
  windowMs: 60_000,
  max: config.security.iotRateLimitMax,
  keyGenerator: (req) => req.params.id || req.ip || 'unknown',
  skip: () => config.env === 'test',
  message: { success: false, error: { code: 'AS-429', message: 'Sensor ingestion rate limit exceeded for this device' } },
});

const registerNodeSchema = z.object({
  farm_id:      z.string().uuid(),
  zone_id:      z.string().uuid().optional(),
  device_id:    z.string().min(8).max(64),
  name:         z.string().max(100).optional(),
  latitude:     z.number().optional(),
  longitude:    z.number().optional(),
  depth_cm:     z.number().int().default(15),
  capabilities: z.array(z.string()).default([]),
});

// ── Physical bounds (mirrors DB trigger validate_sensor_reading — defense in
// depth: reject obviously-impossible values BEFORE they hit the network/DB,
// with a farmer-readable error instead of a raw constraint violation). ──────
export const SENSOR_BOUNDS: Record<string, [number, number]> = {
  SOIL_PH: [0, 14], SOIL_MOISTURE: [0, 100], NITROGEN: [0, 500],
  PHOSPHORUS: [0, 300], POTASSIUM: [0, 1000], SOIL_TEMP: [-10, 60],
  ELECTRICAL_CONDUCTIVITY: [0, 20], ORGANIC_MATTER: [0, 100],
  AMBIENT_TEMP: [-20, 60], HUMIDITY: [0, 100], RAINFALL: [0, 600],
  SOLAR_RADIATION: [0, 45], WIND_SPEED: [0, 250], WIND_DIRECTION: [0, 360],
};

const readingSchema = z.object({
  time:        z.string().datetime().optional(),
  sensor_type: z.string(),
  value:       z.number(),
  unit:        z.string().default(''),
  raw_payload: z.any().optional(),
}).superRefine((r, ctx) => {
  const bounds = SENSOR_BOUNDS[r.sensor_type];
  if (bounds && (r.value < bounds[0] || r.value > bounds[1])) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `AS-022: ${r.value} is outside the physically possible range [${bounds[0]}, ${bounds[1]}] for ${r.sensor_type}. Reading rejected — check sensor wiring/calibration before resubmitting.`,
    });
  }
});

const batchReadingSchema = z.object({
  readings: z.array(readingSchema),
});

// GET /sensors?farm_id=
sensorsRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    const nodes = await dbQuery<SensorNode>(
      `SELECT * FROM sensor_nodes WHERE farm_id = $1 ORDER BY name`,
      [farm_id]
    );
    res.json({ success: true, data: { nodes } });
  } catch (err) { next(err); }
});

// POST /sensors/register
sensorsRouter.post('/register', async (req, res, next) => {
  try {
    const body = registerNodeSchema.parse(req.body);
    // Check farm ownership
    const farm = await dbQueryOne(
      'SELECT id FROM farms WHERE id = $1 AND owner_id = $2', [body.farm_id, req.user!.sub]
    );
    if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm not found or access denied');

    const existing = await dbQueryOne('SELECT id FROM sensor_nodes WHERE device_id = $1', [body.device_id]);
    if (existing) throw new AppError(409, ErrorCodes.NODE_ALREADY_EXISTS, 'Device already registered');

    const [node] = await dbQuery<SensorNode>(
      `INSERT INTO sensor_nodes (farm_id, zone_id, device_id, name, latitude, longitude, depth_cm, capabilities)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [body.farm_id, body.zone_id, body.device_id, body.name, body.latitude,
       body.longitude, body.depth_cm, JSON.stringify(body.capabilities)]
    );

    // Climate FieldView-inspired automated location-error detection: the DB
    // trigger already set location_flag if this node is >30km from its farm.
    // Surface that as a real, visible alert — not just a silent audit row.
    if ((node as any).location_flag) {
      const [alert] = await dbQuery(
        `INSERT INTO alerts (farm_id, alert_type, severity, title, message, recommendation)
         VALUES ($1,'SENSOR_OFFLINE','WATCH',$2,$3,$4) RETURNING *`,
        [body.farm_id, 'Sensor location looks wrong',
         `New node "${node.name ?? node.device_id}" reports coordinates more than 30km from this farm. This usually means a GPS fault or the device was provisioned for a different field.`,
         'Verify the device GPS fix and re-register if it was physically moved. Readings from this node are de-prioritised in scoring until resolved.']
      );
      wsBroadcast(body.farm_id, 'ALERT_FIRED', alert);
    }

    res.status(201).json({ success: true, data: { node } });
  } catch (err) { next(err); }
});

// GET /sensors/:id
sensorsRouter.get('/:id', async (req, res, next) => {
  try {
    const node = await dbQueryOne<SensorNode>('SELECT * FROM sensor_nodes WHERE id = $1', [req.params.id]);
    if (!node) throw new AppError(404, ErrorCodes.NODE_NOT_FOUND, 'Sensor node not found');
    res.json({ success: true, data: { node } });
  } catch (err) { next(err); }
});

// POST /sensors/:id/readings — ingest single or batch from IoT device
sensorsRouter.post('/:id/readings', ingestionLimiter, async (req, res, next) => {
  try {
    const node = await dbQueryOne<SensorNode & { farm_owner: string }>(
      `SELECT sn.*, f.owner_id AS farm_owner
       FROM sensor_nodes sn JOIN farms f ON f.id = sn.farm_id
       WHERE sn.id = $1`,
      [req.params.id]
    );
    if (!node) throw new AppError(404, ErrorCodes.NODE_NOT_FOUND, 'Node not found');

    const { readings } = batchReadingSchema.parse(
      Array.isArray(req.body.readings) ? req.body : { readings: [req.body] }
    );

    const inserted: SensorReading[] = [];
    for (const r of readings) {
      const ts = r.time ?? new Date().toISOString();
      // Run anomaly detection via ML service (fire-and-forget)
      let quality_score = 100;
      let is_anomaly = false;
      try {
        const anomaly = await mlService.detectAnomaly(node.id, r.sensor_type as SensorType, r.value);
        quality_score = anomaly.quality_score;
        is_anomaly = anomaly.is_anomaly;
      } catch { /* ML service unavailable — proceed with raw data */ }

      const [row] = await dbQuery<SensorReading>(
        `INSERT INTO sensor_readings (time, node_id, farm_id, sensor_type, value, unit, quality_score, is_anomaly, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ts, node.id, node.farm_id, r.sensor_type, r.value, r.unit, quality_score, is_anomaly, r.raw_payload ? JSON.stringify(r.raw_payload) : null]
      );
      inserted.push(row);

      // Update node last_seen + recompute trust score (calibration age +
      // 7-day anomaly rate + location flag — see recompute_node_trust()).
      await dbQuery('UPDATE sensor_nodes SET last_seen_at = NOW(), status = $1 WHERE id = $2', ['ONLINE', node.id]);
      // recompute_node_trust() UPDATEs sensor_nodes.trust_score as a side
      // effect; the per-iteration return value isn't needed since the
      // response reads the final trust_score once, after the loop.
      await dbQuery('SELECT recompute_node_trust($1)', [node.id]).catch(() => {});

      // Broadcast to WebSocket clients
      wsBroadcast(node.farm_id, 'SENSOR_UPDATE', row);

      // Check for alerts
      await alertService.checkSensorReading(node.farm_id, r.sensor_type as SensorType, r.value, node.id);
    }
    const [latestTrust] = await dbQuery<{ trust_score: number }>('SELECT trust_score FROM sensor_nodes WHERE id=$1', [node.id]);
    res.status(201).json({ success: true, data: { inserted: inserted.length, node_trust_score: latestTrust?.trust_score ?? 100 } });
  } catch (err) { next(err); }
});

// GET /sensors/:id/readings
sensorsRouter.get('/:id/readings', async (req, res, next) => {
  try {
    const { sensor_type, from, to, limit = '100' } = req.query;
    const params: any[] = [req.params.id];
    let q = 'SELECT time, sensor_type, value, unit, quality_score, is_anomaly FROM sensor_readings WHERE node_id = $1';
    if (sensor_type) { params.push(sensor_type); q += ` AND sensor_type = $${params.length}`; }
    if (from) { params.push(from); q += ` AND time >= $${params.length}`; }
    if (to)   { params.push(to);   q += ` AND time <= $${params.length}`; }
    q += ` ORDER BY time DESC LIMIT ${Math.min(parseInt(limit as string), 1000)}`;
    const readings = await dbQuery<SensorReading>(q, params);
    res.json({ success: true, data: { readings } });
  } catch (err) { next(err); }
});

// GET /sensors/:id/latest — most recent value per sensor type
sensorsRouter.get('/:id/latest', async (req, res, next) => {
  try {
    const readings = await dbQuery(
      `SELECT DISTINCT ON (sensor_type) sensor_type, value, unit, time, quality_score, is_anomaly
       FROM sensor_readings WHERE node_id = $1
       ORDER BY sensor_type, time DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: { readings } });
  } catch (err) { next(err); }
});
