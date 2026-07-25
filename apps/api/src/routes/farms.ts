/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router } from 'express';
import { z } from 'zod';
import { dbQuery, dbQueryOne } from '../db';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { Farm, ErrorCodes } from '../types';

export const farmsRouter = Router();
farmsRouter.use(authenticate);

const createFarmSchema = z.object({
  name:          z.string().min(2).max(255),
  description:   z.string().optional(),
  latitude:      z.number().min(-90).max(90),
  longitude:     z.number().min(-180).max(180),
  elevation_m:   z.number().optional(),
  county:        z.string().optional(),
  country:       z.string().default('Kenya'),
  total_area_ha: z.number().positive(),
  rainfall_zone: z.enum(['Arid', 'Semi-Arid', 'Sub-Humid', 'Humid']).optional(),
  soil_type:     z.string().optional(),
  timezone:      z.string().default('Africa/Nairobi'),
  season_zone:   z.string().default('EAF'),
});

async function assertFarmAccess(farmId: string, userId: string) {
  const farm = await dbQueryOne<Farm>(
    'SELECT * FROM farms WHERE id = $1 AND is_active = true', [farmId]
  );
  if (!farm) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'Farm not found');
  if (farm.owner_id !== userId) {
    throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'You do not own this farm');
  }
  return farm;
}

// GET /farms
farmsRouter.get('/', async (req, res, next) => {
  try {
    const farms = await dbQuery<Farm>(
      `SELECT f.*, 
        (SELECT COUNT(*) FROM sensor_nodes s WHERE s.farm_id = f.id) AS node_count,
        (SELECT COUNT(*) FROM crop_cycles c WHERE c.farm_id = f.id AND c.is_active = true) AS active_crops
       FROM farms f WHERE f.owner_id = $1 AND f.is_active = true
       ORDER BY f.created_at DESC`,
      [req.user!.sub]
    );
    res.json({ success: true, data: { farms } });
  } catch (err) { next(err); }
});

// POST /farms
farmsRouter.post('/', async (req, res, next) => {
  try {
    const body = createFarmSchema.parse(req.body);
    const [farm] = await dbQuery<Farm>(
      `INSERT INTO farms (owner_id, name, description, latitude, longitude, elevation_m,
         county, country, total_area_ha, rainfall_zone, soil_type, timezone, season_zone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [req.user!.sub, body.name, body.description, body.latitude, body.longitude,
       body.elevation_m, body.county, body.country, body.total_area_ha,
       body.rainfall_zone, body.soil_type, body.timezone, body.season_zone]
    );
    res.status(201).json({ success: true, data: { farm } });
  } catch (err) { next(err); }
});

// GET /farms/:id
farmsRouter.get('/:id', async (req, res, next) => {
  try {
    const farm = await assertFarmAccess(req.params.id, req.user!.sub);
    res.json({ success: true, data: { farm } });
  } catch (err) { next(err); }
});

// PATCH /farms/:id
farmsRouter.patch('/:id', async (req, res, next) => {
  try {
    await assertFarmAccess(req.params.id, req.user!.sub);
    const allowed = ['name','description','rainfall_zone','soil_type','timezone'];
    const entries = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (!entries.length) return res.status(400).json({ success: false, error: { code: ErrorCodes.VALIDATION_ERROR, message: 'No valid fields to update' } });
    const updates = entries.map(([k], i) => `${k} = $${i + 2}`);
    const values = entries.map(([, v]) => v);
    const [farm] = await dbQuery<Farm>(
      `UPDATE farms SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    res.json({ success: true, data: { farm } });
  } catch (err) { next(err); }
});

// DELETE /farms/:id
farmsRouter.delete('/:id', async (req, res, next) => {
  try {
    await assertFarmAccess(req.params.id, req.user!.sub);
    await dbQuery('UPDATE farms SET is_active = false WHERE id = $1', [req.params.id]);
    res.json({ success: true, data: { message: 'Farm deactivated' } });
  } catch (err) { next(err); }
});

// GET /farms/:id/summary  (dashboard hero data)
farmsRouter.get('/:id/summary', async (req, res, next) => {
  try {
    await assertFarmAccess(req.params.id, req.user!.sub);
    const farmId = req.params.id;

    const [latestSFS] = await dbQuery(
      'SELECT total_score, computed_at FROM soil_feasibility_scores WHERE farm_id = $1 ORDER BY computed_at DESC LIMIT 1',
      [farmId]
    );
    const [activeCycle] = await dbQuery(
      `SELECT cc.*, c.name AS crop_name, c.gdd_maturity
       FROM crop_cycles cc JOIN crops c ON c.id = cc.crop_id
       WHERE cc.farm_id = $1 AND cc.is_active = true ORDER BY cc.created_at DESC LIMIT 1`,
      [farmId]
    );
    const [nodeStats] = await dbQuery(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN status='ONLINE' THEN 1 ELSE 0 END) AS online
       FROM sensor_nodes WHERE farm_id = $1`,
      [farmId]
    );
    const [activeAlerts] = await dbQuery(
      `SELECT COUNT(*) AS count FROM alerts WHERE farm_id = $1 AND status = 'ACTIVE'`,
      [farmId]
    );
    const [latestRainfall] = await dbQuery(
      `SELECT COALESCE(SUM(rainfall_mm), 0) AS weekly_rainfall
       FROM weather_readings WHERE farm_id = $1 AND time > NOW() - INTERVAL '7 days'`,
      [farmId]
    );

    res.json({
      success: true,
      data: {
        sfs_score:     latestSFS?.total_score ?? null,
        active_crop:   activeCycle ?? null,
        node_stats:    nodeStats,
        active_alerts: parseInt(activeAlerts?.count ?? '0'),
        weekly_rainfall_mm: parseFloat(latestRainfall?.weekly_rainfall ?? '0'),
      }
    });
  } catch (err) { next(err); }
});
