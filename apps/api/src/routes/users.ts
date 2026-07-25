/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router } from 'express';
import { z } from 'zod';
import { dbQuery } from '../db';
import { authenticate, requireMfa } from '../middleware/auth';
import { User } from '../types';

export const usersRouter = Router();
usersRouter.use(authenticate);

const updateSettingsSchema = z.object({
  full_name:             z.string().min(2).max(255).optional(),
  phone:                 z.string().max(20).optional(),
  language:              z.string().max(10).optional(),
  timezone:              z.string().max(50).optional(),
  data_sharing_consent:  z.boolean().optional(),
}).refine(body => Object.keys(body).length > 0, { message: 'No fields to update' });

// PATCH /users/me — profile and settings updates, including the
// data-sharing consent toggle (see middleware/consent.ts for the
// enforcement side of this — this is the write path, that's the guard).
// requireMfa() is applied because changing profile settings is a sensitive
// operation — users with MFA enabled must re-authenticate with their 2FA.
usersRouter.patch('/me', requireMfa(), async (req, res, next) => {
  try {
    const body = updateSettingsSchema.parse(req.body);
    const entries = Object.entries(body);

    // consent_updated_at is auto-stamped whenever data_sharing_consent
    // changes, so there's an honest audit trail of when a farmer actually
    // opted in or out — relevant the day any data-marketplace feature reads
    // this column for real.
    const setClauses = entries.map(([k], i) => `${k} = $${i + 2}`);
    if ('data_sharing_consent' in body) {
      setClauses.push(`consent_updated_at = NOW()`);
    }
    const values = entries.map(([, v]) => v);

    const [user] = await dbQuery<User>(
      `UPDATE users SET ${setClauses.join(', ')}
       WHERE id = $1
       RETURNING id, email, full_name, phone, role, tier, tier_expires_at,
                 language, timezone, mfa_enabled, last_login_at, is_active, created_at,
                 data_sharing_consent, consent_updated_at`,
      [req.user!.sub, ...values]
    );

    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
});
