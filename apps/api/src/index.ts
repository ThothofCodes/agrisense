/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import http from 'http';

import { config } from './config';
import { logger } from './utils/logger';
import { checkDbConnection } from './db';
import { connectRedis, checkRedisConnection } from './services/redisService';
import { initWebSocket } from './services/wsService';
import { initMqtt } from './services/mqttService';

import { authRouter } from './routes/auth';
import { farmsRouter } from './routes/farms';
import { usersRouter } from './routes/users';
import { insightsRouter } from './routes/insights';
import { sensorsRouter } from './routes/sensors';
import {
  weatherRouter, cropsRouter, cyclesRouter,
  alertsRouter, recommendationsRouter, sfsRouter, paymentsRouter
} from './routes/all';
import { treatmentsRouter, diagnosesRouter, sharesRouter } from './routes/v3';
import { webhooksRouter } from './routes/webhooks';
import { errorHandler, notFound } from './middleware/errorHandler';
import cron from 'node-cron';

const app = express();
const server = http.createServer(app);

// ── Security & Middleware ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: config.security.corsOrigin.split(','),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.isDev ? 'dev' : 'combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// ── Rate Limiting ────────────────────────────────────────────────────────────────
// FOUND VIA HARDWARE SIMULATION (June 2026): a load test simulating multiple
// authenticated farms from one IP hit 429s almost immediately — not from
// the IoT-specific limiter (already fixed in routes/sensors.ts) but from
// THIS general limiter, applied to every /api/v1/* route at 100/min keyed
// by raw IP. Same root cause, one layer up: Ruai Tech Solutions' real
// deployment context is multiple farms behind a single rural NAT'd router,
// and a pure-IP key collapses all of them into one shared budget.
//
// Fix: once a request carries a Bearer token, key by the token's `sub`
// (user id) instead of IP, so each authenticated farmer gets their own
// budget regardless of how many neighbours share their router. This is a
// *lightweight, unverified* decode purely for bucketing — it grants no
// trust; the real cryptographic verification still happens in
// middleware/auth.ts on every protected route regardless of this key.
// Unauthenticated requests (login, register — where IP-based throttling is
// the CORRECT brute-force defence) fall back to IP as before.
function rateLimitKey(req: express.Request): string {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.decode(header.slice(7)) as { sub?: string } | null;
      if (decoded?.sub) return `user:${decoded.sub}`;
    } catch { /* fall through to IP */ }
  }
  return req.ip || 'unknown';
}

// Rate limiting is skipped entirely under NODE_ENV=test. This is the
// standard, widely-used pattern (every major Node API does this) — without
// it, a fast integration-test suite making several auth/API calls in
// immediate succession trips the SAME limiters that correctly protect real
// traffic, for reasons that have nothing to do with real abuse. Confirmed
// safe: this branch is unreachable in production, where NODE_ENV is always
// 'production' or 'development', never 'test'.
const skipInTest = () => config.env === 'test';

const apiLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max:      config.security.rateLimitMax,
  keyGenerator: rateLimitKey,
  skip: skipInTest,
  message:  { success: false, error: { code: 'AS-429', message: 'Too many requests' } },
});
const authLimiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max:      config.security.authRateLimitMax,
  skip: skipInTest,
  message:  { success: false, error: { code: 'AS-429', message: 'Too many authentication attempts' } },
});
// NOTE: sensor *ingestion* (POST /:id/readings) has its own dedicated,
// device-keyed limiter defined in routes/sensors.ts — see the comment there
// for why a single router-wide, IP-keyed limiter was wrong for this
// specific endpoint. The rest of the /sensors router (registration,
// dashboard reads) is protected by the general apiLimiter below.

app.use(config.apiPrefix, apiLimiter);

// ── Health Check ─────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const [db, redis] = await Promise.all([checkDbConnection(), checkRedisConnection()]);
  const status = db && redis ? 'healthy' : 'degraded';
  res.status(db && redis ? 200 : 503).json({
    status,
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: { db, redis },
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────────
const V1 = config.apiPrefix;
app.use(`${V1}/auth`,            authLimiter, authRouter);
app.use(`${V1}/farms`,           farmsRouter);
app.use(`${V1}/users`,           usersRouter);
app.use(`${V1}/insights`,        insightsRouter);
app.use(`${V1}/sensors`,         sensorsRouter);
app.use(`${V1}/weather`,         weatherRouter);
app.use(`${V1}/crops`,           cropsRouter);
app.use(`${V1}/cycles`,          cyclesRouter);
app.use(`${V1}/alerts`,          alertsRouter);
app.use(`${V1}/recommendations`, recommendationsRouter);
app.use(`${V1}/sfs`,             sfsRouter);
app.use(`${V1}/payments`,        paymentsRouter);
app.use(`${V1}/treatments`,      treatmentsRouter);
app.use(`${V1}/diagnoses`,       diagnosesRouter);
app.use(`${V1}/shares`,          sharesRouter);
// Clerk webhooks need the raw body for Svix signature verification — mount
// raw body parser before the route so req.body stays as a Buffer.
app.use(`${V1}/webhooks/clerk`, express.raw({ type: 'application/json' }), webhooksRouter);

// ── 404 & Error Handler ───────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Scheduled Jobs ─────────────────────────────────────────────────────────────────
function registerCronJobs() {
  // Mark nodes offline if not seen in 2 hours
  cron.schedule('*/30 * * * *', async () => {
    const { dbQuery } = await import('./db');
    await dbQuery(
      `UPDATE sensor_nodes SET status='OFFLINE'
       WHERE status='ONLINE' AND last_seen_at < NOW() - INTERVAL '2 hours'`
    ).catch(e => logger.error('Cron: mark offline failed', { error: e.message }));
  });

  // Refresh weather for all active farms every hour
  cron.schedule('0 * * * *', async () => {
    const { dbQuery } = await import('./db');
    const { weatherService } = await import('./services/weatherService');
    const farms = await dbQuery('SELECT id, latitude, longitude FROM farms WHERE is_active=true').catch(() => []);
    for (const farm of farms as any[]) {
      await weatherService.getCurrentWeather(farm.latitude, farm.longitude, farm.id).catch(() => {});
    }
    logger.info('Cron: weather refresh complete', { farms: farms.length });
  });

  // ── Daily GDD accumulation (gap caught via live end-to-end testing) ────────
  // GDD previously only advanced when a user happened to open the dashboard
  // and call GET /cycles/:id/gdd. A farmer who doesn't check the app for a
  // week would have a crop_cycle frozen at whatever GDD it had a week ago —
  // silently wrong, and it would make the proactive GDD_DEFICIT alert compare
  // against a stale baseline rather than reality. This tick runs once daily
  // for every active cycle regardless of whether anyone is looking at the UI.
  cron.schedule('0 1 * * *', async () => {
    const { dbQuery } = await import('./db');
    const { mlService } = await import('./services/mlService');
    const { alertService } = await import('./services/alertService');

    const cycles = await dbQuery<any>(
      `SELECT cc.*, c.gdd_base_temp, c.gdd_maturity, c.gdd_emergence, c.gdd_flowering,
              c.name AS crop_name, c.typical_days_to_maturity
       FROM crop_cycles cc JOIN crops c ON c.id = cc.crop_id
       WHERE cc.is_active = true AND cc.planted_at IS NOT NULL`
    ).catch(() => []);

    for (const cycle of cycles as any[]) {
      try {
        const [weather] = await dbQuery<any>(
          `SELECT AVG(temp_max) AS temp_max, AVG(temp_min) AS temp_min
           FROM weather_readings WHERE farm_id=$1 AND time > NOW() - INTERVAL '24 hours' AND is_forecast=false`,
          [cycle.farm_id]
        );
        const gdd = await mlService.computeGDD({
          tmax: weather?.temp_max ?? 25, tmin: weather?.temp_min ?? 15,
          base_temp: cycle.gdd_base_temp, gdd_cumulative: parseFloat(cycle.gdd_accumulated),
          gdd_emergence: cycle.gdd_emergence, gdd_flowering: cycle.gdd_flowering,
          gdd_maturity: cycle.gdd_maturity, planted_at: cycle.planted_at,
        });
        await dbQuery('UPDATE crop_cycles SET gdd_accumulated=$1, current_stage=$2, updated_at=NOW() WHERE id=$3',
          [gdd.gdd_cumulative, gdd.current_stage, cycle.id]);
        await alertService.checkGddDeficit({
          farmId: cycle.farm_id, cropCycleId: cycle.id, cropName: cycle.crop_name,
          plantedAt: cycle.planted_at, gddAccumulated: gdd.gdd_cumulative,
          gddMaturity: cycle.gdd_maturity, typicalDaysToMaturity: cycle.typical_days_to_maturity,
        });
      } catch (e: any) {
        logger.error('Cron: GDD tick failed for cycle', { cycleId: cycle.id, error: e.message });
      }
    }
    logger.info('Cron: daily GDD tick complete', { cycles: (cycles as any[]).length });
  });

  logger.info('Cron jobs registered');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    await connectRedis();
    logger.info('Redis connected');

    const dbOk = await checkDbConnection();
    if (!dbOk) throw new Error('Database connection failed');
    logger.info('PostgreSQL connected');

    initWebSocket(server);
    initMqtt();
    registerCronJobs();

    server.listen(config.port, () => {
      logger.info(`AgriSense API running on port ${config.port}`, {
        env:  config.env,
        pid:  process.pid,
      });
    });
  } catch (err: any) {
    logger.error('Bootstrap failed', { error: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down');
  server.close(() => process.exit(0));
});

// ── Test-safety fix (root-caused after a real Jest hang in a prior session):
// importing this module for `app` (e.g. supertest) must NOT have the
// side effect of connecting to Redis/MQTT, scheduling cron jobs, and
// opening a real listening socket — those background handles are exactly
// what kept the event loop alive and forced a hard kill of the whole
// sandbox process group. Only auto-bootstrap when this file is the actual
// entrypoint (`node dist/index.js` / `tsx src/index.ts`), never on import.
if (require.main === module) {
  bootstrap();
}

export { app, server, bootstrap };
