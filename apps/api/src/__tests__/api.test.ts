/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

// apps/api/src/__tests__/api.test.ts
// Integration test suite for AgriSense API
// Run: npm test  (requires .env.test with DB_NAME=agrisense_test)

import request from 'supertest';
import { app } from '../index';
import { ErrorCodes } from '../types';
import { db } from '../db';

let accessToken: string;
let farmId: string;
let nodeId: string;

const testUser = {
  email: `test_${Date.now()}@agrisense.test`,
  password: 'TestPass123!',
  full_name: 'Test Farmer',
  timezone: 'Africa/Nairobi',
};

afterAll(async () => {
  await db.end();
});

// ── Auth ─────────────────────────────────────────────────────────────────────
describe('Auth', () => {
  it('POST /auth/register → 201 with tokens', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(testUser);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    accessToken = res.body.data.tokens.accessToken;
  });

  it('POST /auth/register with duplicate email → 409', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(testUser);
    expect(res.status).toBe(409);
  });

  it('POST /auth/login with correct creds → 200', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: testUser.email, password: testUser.password,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(testUser.email);
    accessToken = res.body.data.tokens.accessToken;
  });

  it('POST /auth/login with wrong password → 401', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      email: testUser.email, password: 'WrongPassword',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AS-001');
  });

  it('GET /auth/me with valid token → 200', async () => {
    const res = await request(app).get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.full_name).toBe(testUser.full_name);
  });

  it('GET /auth/me without token → 401', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Farms ────────────────────────────────────────────────────────────────────
describe('Farms', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('POST /farms → 201', async () => {
    const res = await request(app).post('/api/v1/farms')
      .set(authHeader())
      .send({
        name: 'Test Farm Nairobi',
        latitude: -1.2921,
        longitude: 36.8219,
        total_area_ha: 5.5,
        county: 'Nairobi',
        season_zone: 'EAF',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.farm.name).toBe('Test Farm Nairobi');
    farmId = res.body.data.farm.id;
  });

  it('GET /farms → lists farms', async () => {
    const res = await request(app).get('/api/v1/farms').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.farms.length).toBeGreaterThan(0);
  });

  it('GET /farms/:id → farm detail', async () => {
    const res = await request(app).get(`/api/v1/farms/${farmId}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.farm.id).toBe(farmId);
  });

  it('GET /farms/:id/summary → dashboard data', async () => {
    const res = await request(app).get(`/api/v1/farms/${farmId}/summary`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('active_alerts');
    expect(res.body.data).toHaveProperty('node_stats');
  });

  it('PATCH /farms/:id → updates name', async () => {
    const res = await request(app).patch(`/api/v1/farms/${farmId}`)
      .set(authHeader()).send({ name: 'Updated Farm Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.farm.name).toBe('Updated Farm Name');
  });
});

// ── Sensors ───────────────────────────────────────────────────────────────────
describe('Sensors', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('POST /sensors/register → 201', async () => {
    const res = await request(app).post('/api/v1/sensors/register')
      .set(authHeader())
      .send({
        farm_id: farmId,
        device_id: `test_device_${Date.now()}`,
        name: 'Node A',
        depth_cm: 15,
        capabilities: ['SOIL_PH', 'SOIL_MOISTURE', 'NITROGEN'],
      });
    expect(res.status).toBe(201);
    nodeId = res.body.data.node.id;
  });

  it('GET /sensors?farm_id → lists nodes', async () => {
    const res = await request(app).get(`/api/v1/sensors?farm_id=${farmId}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.nodes.length).toBeGreaterThan(0);
  });

  it('POST /sensors/:id/readings → 201 (single)', async () => {
    const res = await request(app).post(`/api/v1/sensors/${nodeId}/readings`)
      .set(authHeader())
      .send({ sensor_type: 'SOIL_PH', value: 6.4, unit: 'pH' });
    expect(res.status).toBe(201);
    expect(res.body.data.inserted).toBe(1);
  });

  it('POST /sensors/:id/readings → 201 (batch)', async () => {
    const res = await request(app).post(`/api/v1/sensors/${nodeId}/readings`)
      .set(authHeader())
      .send({ readings: [
        { sensor_type: 'SOIL_MOISTURE', value: 65, unit: '%' },
        { sensor_type: 'NITROGEN', value: 22, unit: 'mg/kg' },
      ]});
    expect(res.status).toBe(201);
    expect(res.body.data.inserted).toBe(2);
  });

  it('GET /sensors/:id/latest → returns latest per type', async () => {
    const res = await request(app).get(`/api/v1/sensors/${nodeId}/latest`).set(authHeader());
    expect(res.status).toBe(200);
    const types = res.body.data.readings.map((r: any) => r.sensor_type);
    expect(types).toContain('SOIL_PH');
  });
});

// ── Crops & Calendar ─────────────────────────────────────────────────────────
describe('Crops', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('GET /crops → returns crop list', async () => {
    const res = await request(app).get('/api/v1/crops').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.crops.length).toBeGreaterThan(0);
  });

  it('GET /crops/calendar/EAF → returns EAF calendar', async () => {
    const res = await request(app).get('/api/v1/crops/calendar/EAF').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.calendar.length).toBeGreaterThan(0);
    // Verify EAF season labels present
    const labels = res.body.data.calendar.map((r: any) => r.season_label);
    expect(labels).toContain('Long Rains');
  });
});

// ── SFS ───────────────────────────────────────────────────────────────────────
describe('SFS', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('GET /sfs/:farmId → returns score object', async () => {
    const res = await request(app).get(`/api/v1/sfs/${farmId}`).set(authHeader());
    expect(res.status).toBe(200);
    const { sfs } = res.body.data;
    expect(sfs.total_score).toBeGreaterThanOrEqual(0);
    expect(sfs.total_score).toBeLessThanOrEqual(100);
    expect(sfs).toHaveProperty('ph_score');
    expect(sfs).toHaveProperty('ec_score');      // Audit fix I1
    expect(sfs).toHaveProperty('soil_temp_score'); // Audit fix I1
  });
});

// ── Alerts ────────────────────────────────────────────────────────────────────
describe('Alerts', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('GET /alerts?farm_id → returns empty initially', async () => {
    const res = await request(app).get(`/api/v1/alerts?farm_id=${farmId}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.alerts)).toBe(true);
  });
});

// ── Quick Soil Check (UjuziKilimo competitive response) ─────────────────────
describe('Quick Soil Check — manual SFS entry', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });
  const validPayload = {
    ph: 6.4, nitrogen: 22, phosphorus: 14, potassium: 130,
    moisture: 65, ec: 0.4, organic_matter: 2.8, soil_temp: 19,
    notes: 'Jest test entry',
  };

  it('POST /sfs/:farmId/manual with valid data → 201, source=MANUAL, fixed trust score', async () => {
    const res = await request(app).post(`/api/v1/sfs/${farmId}/manual`).set(authHeader()).send(validPayload);
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe('MANUAL');
    expect(res.body.data.avg_sensor_trust_score).toBe(70);
    expect(res.body.data.data_completeness_pct).toBe(100);
    expect(res.body.data.sfs.total_score).toBeGreaterThanOrEqual(0);
    expect(res.body.data.sfs.total_score).toBeLessThanOrEqual(100);
  });

  it('POST /sfs/:farmId/manual with impossible pH=22 → 400, rejected same as sensor pathway', async () => {
    const res = await request(app).post(`/api/v1/sfs/${farmId}/manual`).set(authHeader())
      .send({ ...validPayload, ph: 22 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('POST /sfs/:farmId/manual for a farm the user does not own → 403', async () => {
    const res = await request(app).post(`/api/v1/sfs/00000000-0000-0000-0000-000000000000/manual`)
      .set(authHeader()).send(validPayload);
    expect(res.status).toBe(403);
  });
});

// ── Data-sharing consent enforcement ─────────────────────────────────────────
describe('Data-sharing consent — PATCH /users/me + guarded /insights routes', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('GET /auth/me exposes data_sharing_consent (was previously not selected)', async () => {
    const res = await request(app).get('/api/v1/auth/me').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.user).toHaveProperty('data_sharing_consent');
  });

  it('GET /insights/benchmark/:farmId without consent → 403 AS-060', async () => {
    // Ensure consent is off for this assertion regardless of prior test order.
    await request(app).patch('/api/v1/users/me').set(authHeader()).send({ data_sharing_consent: false });
    const res = await request(app).get(`/api/v1/insights/benchmark/${farmId}`).set(authHeader());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AS-060');
  });

  it('PATCH /users/me toggles consent and stamps consent_updated_at', async () => {
    const res = await request(app).patch('/api/v1/users/me').set(authHeader()).send({ data_sharing_consent: true });
    expect(res.status).toBe(200);
    expect(res.body.data.user.data_sharing_consent).toBe(true);
    expect(res.body.data.user.consent_updated_at).toBeTruthy();
  });

  it('GET /insights/benchmark/:farmId after consenting → 200, honest about peer count', async () => {
    const res = await request(app).get(`/api/v1/insights/benchmark/${farmId}`).set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('peer_count');
    // In an isolated test DB there are no other consenting farms in this
    // county, so the honest, non-fabricated response is available:false.
    expect(res.body.data.available).toBe(false);
  });
});

// ── Regression: ML response-shape bug caught via live testing, June 2026 ────
// mlService.getCropRecommendations() once read `data.recommendations` from a
// response that was actually a bare array, silently returning `undefined`
// and crashing downstream on `.map()`. This guards against that class of bug
// recurring if the ML response contract changes again.
describe('Regression — ML recommendation response shape', () => {
  const authHeader = () => ({ Authorization: `Bearer ${accessToken}` });

  it('POST /recommendations/crops never 500s with a map-on-undefined error', async () => {
    const res = await request(app).post('/api/v1/recommendations/crops')
      .set(authHeader()).send({ farm_id: farmId });
    // Either a clean 200 with an array, or a clean 4xx — never an unhandled 500
    expect(res.status).not.toBe(500);
    if (res.status === 200) {
      expect(Array.isArray(res.body.data.recommendations)).toBe(true);
      expect(res.body.data).toHaveProperty('data_completeness_pct');
      expect(res.body.data).toHaveProperty('requires_agronomist_review');
    }
  });
});

// ── Error handling ────────────────────────────────────────────────────────────
describe('Error Handling', () => {
  it('Unknown route → 404 with AS-404 code', async () => {
    const res = await request(app).get('/api/v1/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('AS-404');
  });

  it('Zod validation error → 400 with AS-090', async () => {
    const res = await request(app).post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('AS-090');
  });
});
