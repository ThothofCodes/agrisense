/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Request, Response, NextFunction } from 'express';
import { dbQueryOne } from '../db';
import { ErrorCodes } from '../types';
/**
 * Guards any route requiring the user's explicit data-sharing opt-in.
 *
 * Per QWEN_QODER_IMPLEMENTATION_PROMPT.md §2.2: `users.data_sharing_consent`
 * has existed in the schema since migration 002 with nothing reading or
 * writing it — exactly the kind of unused column the project's own gap
 * analysis calls out as worse than no column at all, because it implies a
 * working feature that doesn't exist. This guard exists so the consent flag
 * is real and enforced *before* any data-marketplace/aggregate-export
 * endpoint is built — not bolted on after the fact.
 *
 * Deliberate deviation from requireRole()/requireTier(): those trust the
 * role/tier claims already embedded in the JWT at login time, which is fine
 * for role/tier because re-authenticating after a role change is a
 * reasonable expectation. Consent is different — a user must be able to
 * revoke data-sharing consent and have it take effect on their very next
 * request, not after their next login. So this guard does a live DB lookup
 * every time rather than trusting a JWT claim. The extra query is an
 * acceptable cost on what is expected to be a low-traffic, non-hot-path
 * route category (data export/marketplace endpoints), not something called
 * on every sensor-ingestion request.
 */
export async function requireDataSharingConsent(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ success: false, error: { code: ErrorCodes.TOKEN_INVALID, message: 'Not authenticated' } });
  }

  const user = await dbQueryOne<{ data_sharing_consent: boolean }>(
    'SELECT data_sharing_consent FROM users WHERE id = $1',
    [req.user.sub]
  );

  if (!user) {
    return res.status(401).json({ success: false, error: { code: ErrorCodes.TOKEN_INVALID, message: 'User not found' } });
  }

  if (!user.data_sharing_consent) {
    return res.status(403).json({
      success: false,
      error: {
        code: ErrorCodes.CONSENT_REQUIRED,
        message: 'This feature requires data-sharing consent. Enable it in Settings to use this feature.',
      },
    });
  }

  next();
}
