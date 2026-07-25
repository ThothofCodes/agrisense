/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

// ============================================================================
// AgriSense v3 — Competitive-Insight Feature Routes
// ----------------------------------------------------------------------------
// treatmentsRouter   — Plantix-inspired spray/treatment diary + PHI compliance
// diagnosesRouter    — Plantix-inspired photo pest/disease queue (honest:
//                       no trained CV model exists yet, so every submission
//                       is logged for future training AND routed to a human
//                       agronomist review queue rather than faking a verdict)
// sharesRouter       — Climate FieldView-inspired trusted-advisor sharing
// ============================================================================
import { Router } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { dbQuery, dbQueryOne } from '../db';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { ErrorCodes } from '../types';

async function assertFarmOwnership(farmId: string, userId: string) {
  const farm = await dbQueryOne<any>('SELECT * FROM farms WHERE id=$1 AND owner_id=$2', [farmId, userId]);
  if (!farm) throw new AppError(403, ErrorCodes.FARM_ACCESS_DENIED, 'Farm not found or access denied');
  return farm;
}

// ── Treatment / Spray Diary ────────────────────────────────────────────────
export const treatmentsRouter = Router();
treatmentsRouter.use(authenticate);

const treatmentSchema = z.object({
  farm_id:        z.string().uuid(),
  zone_id:        z.string().uuid().optional(),
  crop_cycle_id:  z.string().uuid().optional(),
  treatment_type: z.enum(['PESTICIDE','HERBICIDE','FUNGICIDE','FERTILISER','ORGANIC','BIOLOGICAL_CONTROL','OTHER']),
  product_name:   z.string().min(2).max(150),
  active_ingredient: z.string().max(150).optional(),
  application_rate: z.number().positive().optional(),
  rate_unit:        z.string().max(20).optional(),
  pre_harvest_interval_days: z.number().int().min(0).max(365).optional(),
  applied_at:       z.string().datetime().optional(),
  notes:            z.string().optional(),
});

treatmentsRouter.post('/', async (req, res, next) => {
  try {
    const body = treatmentSchema.parse(req.body);
    await assertFarmOwnership(body.farm_id, req.user!.sub);

    const [log] = await dbQuery(
      `INSERT INTO treatment_logs (farm_id, zone_id, crop_cycle_id, applied_by, treatment_type,
         product_name, active_ingredient, application_rate, rate_unit, pre_harvest_interval_days, applied_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,NOW()),$12) RETURNING *`,
      [body.farm_id, body.zone_id ?? null, body.crop_cycle_id ?? null, req.user!.sub, body.treatment_type,
       body.product_name, body.active_ingredient ?? null, body.application_rate ?? null,
       body.rate_unit ?? null, body.pre_harvest_interval_days ?? null, body.applied_at ?? null, body.notes ?? null]
    );

    // Compute safe-to-harvest date in the app layer (Postgres correctly
    // rejects timestamptz+interval as a STORED generated column — see
    // migration 002 comment — so it's derived here on write and on read).
    const safeHarvestAfter = body.pre_harvest_interval_days
      ? new Date(new Date(log.applied_at).getTime() + body.pre_harvest_interval_days * 86400000)
      : null;

    res.status(201).json({ success: true, data: { treatment: { ...log, safe_harvest_after: safeHarvestAfter } } });
  } catch (err) { next(err); }
});

treatmentsRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    await assertFarmOwnership(farm_id as string, req.user!.sub);

    const logs = await dbQuery<any>(
      'SELECT * FROM treatment_logs WHERE farm_id=$1 ORDER BY applied_at DESC LIMIT 200',
      [farm_id]
    );
    const withHarvestDates = logs.map(l => ({
      ...l,
      safe_harvest_after: l.pre_harvest_interval_days
        ? new Date(new Date(l.applied_at).getTime() + l.pre_harvest_interval_days * 86400000)
        : null,
    }));
    res.json({ success: true, data: { treatments: withHarvestDates } });
  } catch (err) { next(err); }
});

// Pre-Harvest-Interval compliance check — "can I harvest today without
// violating a withdrawal period?" Directly serves food-safety, not just
// food-security: this is the difference between produce that's legal to
// sell and produce that isn't yet.
treatmentsRouter.get('/phi-check/:cropCycleId', async (req, res, next) => {
  try {
    const active = await dbQuery<any>(
      `SELECT * FROM treatment_logs
       WHERE crop_cycle_id=$1 AND pre_harvest_interval_days IS NOT NULL
       ORDER BY applied_at DESC`,
      [req.params.cropCycleId]
    );
    const now = Date.now();
    const blocking = active
      .map(t => ({ ...t, safe_harvest_after: new Date(new Date(t.applied_at).getTime() + t.pre_harvest_interval_days * 86400000) }))
      .filter(t => t.safe_harvest_after.getTime() > now);

    res.json({
      success: true,
      data: {
        safe_to_harvest: blocking.length === 0,
        blocking_treatments: blocking,
        earliest_safe_harvest: blocking.length
          ? new Date(Math.max(...blocking.map(t => t.safe_harvest_after.getTime())))
          : null,
      }
    });
  } catch (err) { next(err); }
});

// ── Photo-Based Pest/Disease Diagnosis Queue ──────────────────────────────
export const diagnosesRouter = Router();
diagnosesRouter.use(authenticate);

const diagnosisSchema = z.object({
  farm_id:       z.string().uuid(),
  zone_id:       z.string().uuid().optional(),
  crop_cycle_id: z.string().uuid().optional(),
  image_ref:     z.string().min(1),       // URL/path to already-uploaded image
  image_size_bytes: z.number().int().positive().max(15_000_000).optional(), // 15MB ceiling
  symptom_tags:  z.array(z.string().max(40)).max(10).default([]),
});

diagnosesRouter.post('/', async (req, res, next) => {
  try {
    const body = diagnosisSchema.parse(req.body);
    await assertFarmOwnership(body.farm_id, req.user!.sub);

    // HONEST ARCHITECTURE NOTE: Plantix reached >90% accuracy across 800+
    // symptoms after years of labelled training data. AgriSense has no
    // trained CV model yet. Rather than fabricate a confident-sounding
    // diagnosis, every submission is queued for agronomist review AND
    // retained as labelled training data for the day a real model exists —
    // see model_registry.py's same fail-honest pattern for every other
    // model slot in this codebase.
    const [diagnosis] = await dbQuery(
      `INSERT INTO photo_diagnoses (farm_id, zone_id, crop_cycle_id, submitted_by, image_ref, image_size_bytes, symptom_tags, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING_REVIEW') RETURNING *`,
      [body.farm_id, body.zone_id ?? null, body.crop_cycle_id ?? null, req.user!.sub,
       body.image_ref, body.image_size_bytes ?? null, body.symptom_tags]
    );

    res.status(201).json({
      success: true,
      data: {
        diagnosis,
        message: 'Photo received and queued for agronomist review. AgriSense does not yet have a trained image-diagnosis model — we will not guess at a verdict. You will be notified once reviewed, typically within 24–48 hours.',
      }
    });
  } catch (err) { next(err); }
});

diagnosesRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    await assertFarmOwnership(farm_id as string, req.user!.sub);
    const diagnoses = await dbQuery('SELECT * FROM photo_diagnoses WHERE farm_id=$1 ORDER BY created_at DESC LIMIT 50', [farm_id]);
    res.json({ success: true, data: { diagnoses } });
  } catch (err) { next(err); }
});

// Agronomist/admin review action
diagnosesRouter.patch('/:id/review', async (req, res, next) => {
  try {
    if (!['ADMIN', 'PROFESSIONAL'].includes(req.user!.role)) {
      throw new AppError(403, ErrorCodes.FORBIDDEN, 'Only agronomist/admin accounts can submit a review');
    }
    const { agronomist_notes, model_label } = req.body;
    const [diagnosis] = await dbQuery(
      `UPDATE photo_diagnoses SET status='AGRONOMIST_REVIEWED', agronomist_notes=$1,
         model_label=$2, reviewed_by=$3, reviewed_at=NOW() WHERE id=$4 RETURNING *`,
      [agronomist_notes ?? null, model_label ?? null, req.user!.sub, req.params.id]
    );
    res.json({ success: true, data: { diagnosis } });
  } catch (err) { next(err); }
});

// ── Trusted-Advisor Sharing ────────────────────────────────────────────────
export const sharesRouter = Router();
sharesRouter.use(authenticate);

sharesRouter.post('/', async (req, res, next) => {
  try {
    const { farm_id, role } = z.object({
      farm_id: z.string().uuid(),
      role: z.enum(['READ_ONLY','AGRONOMIST']).default('READ_ONLY'),
    }).parse(req.body);
    await assertFarmOwnership(farm_id, req.user!.sub);

    const token = crypto.randomBytes(24).toString('base64url');
    const [share] = await dbQuery(
      `INSERT INTO farm_shares (farm_id, token, role, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [farm_id, token, role, req.user!.sub]
    );
    res.status(201).json({ success: true, data: { share, share_url: `/shared/${token}` } });
  } catch (err) { next(err); }
});

sharesRouter.get('/', async (req, res, next) => {
  try {
    const { farm_id } = req.query;
    if (!farm_id) throw new AppError(400, ErrorCodes.VALIDATION_ERROR, 'farm_id required');
    await assertFarmOwnership(farm_id as string, req.user!.sub);
    const shares = await dbQuery(
      'SELECT id, token, role, accepted_by, accepted_at, expires_at, revoked, created_at FROM farm_shares WHERE farm_id=$1 ORDER BY created_at DESC',
      [farm_id]
    );
    res.json({ success: true, data: { shares } });
  } catch (err) { next(err); }
});

sharesRouter.post('/:token/accept', async (req, res, next) => {
  try {
    const share = await dbQueryOne<any>(
      `SELECT * FROM farm_shares WHERE token=$1 AND revoked=false AND expires_at > NOW()`,
      [req.params.token]
    );
    if (!share) throw new AppError(404, 'AS-404', 'Share link not found, expired, or revoked');

    const [updated] = await dbQuery(
      `UPDATE farm_shares SET accepted_by=$1, accepted_at=NOW() WHERE id=$2 RETURNING *`,
      [req.user!.sub, share.id]
    );
    res.json({ success: true, data: { share: updated } });
  } catch (err) { next(err); }
});

sharesRouter.patch('/:id/revoke', async (req, res, next) => {
  try {
    const share = await dbQueryOne<any>('SELECT * FROM farm_shares WHERE id=$1', [req.params.id]);
    if (!share) throw new AppError(404, 'AS-404', 'Share not found');
    await assertFarmOwnership(share.farm_id, req.user!.sub);
    const [updated] = await dbQuery(`UPDATE farm_shares SET revoked=true WHERE id=$1 RETURNING *`, [req.params.id]);
    res.json({ success: true, data: { share: updated } });
  } catch (err) { next(err); }
});
