/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { dbQuery, dbQueryOne } from '../db';
import { config } from '../config';
import { logger } from '../utils/logger';

export const webhooksRouter = Router();

const CLERK_ENABLED = !!(config.clerk.webhookSecret);

/**
 * Clerk webhook endpoint.
 *
 * Clerk sends webhook events (user.created, user.updated, user.deleted) here.
 * We verify the Svix signature, then sync the user to the local PostgreSQL DB.
 *
 * To set this up in the Clerk Dashboard:
 *   1. Go to Webhooks → Add Endpoint
 *   2. Endpoint URL: https://yourdomain.com/api/v1/webhooks/clerk
 *   3. Subscribe to events: user.created, user.updated, user.deleted
 *   4. Copy the Signing Secret into CLERK_WEBHOOK_SECRET in .env
 *
 * For local development, use a tunnel (ngrok, smee.io, etc.) to expose
 * your local server and set that URL in the Clerk Dashboard.
 */
webhooksRouter.post('/', async (req: Request, res: Response) => {
  if (!CLERK_ENABLED) {
    return res.status(200).json({ success: true, message: 'Clerk webhooks not configured' });
  }

  const wh = new Webhook(config.clerk.webhookSecret);

  try {
    const svixId = req.headers['svix-id'] as string;
    const svixTimestamp = req.headers['svix-timestamp'] as string;
    const svixSignature = req.headers['svix-signature'] as string;

    if (!svixId || !svixTimestamp || !svixSignature) {
      logger.warn('Clerk webhook: missing Svix headers');
      return res.status(400).json({ success: false, message: 'Missing Svix headers' });
    }

    if (!req.body) {
      logger.warn('Clerk webhook: empty body');
      return res.status(400).json({ success: false, message: 'Empty request body' });
    }

    // req.body is a Buffer because the route uses express.raw()
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const payload = wh.verify(rawBody, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as any;

    const { type, data } = payload;
    logger.info('Clerk webhook received', { type, userId: data?.id });

    switch (type) {
      case 'user.created':
      case 'user.updated': {
        const { id, email_addresses, first_name, last_name, phone_numbers } = data;
        const primaryEmail = email_addresses?.[0]?.email_address ?? '';
        const primaryPhone = phone_numbers?.[0]?.phone_number ?? null;
        const fullName = [first_name, last_name].filter(Boolean).join(' ') || primaryEmail;

        // 1. If a user with this clerk_id already exists, update them (normal flow)
        const existing = await dbQueryOne('SELECT id, auth_provider FROM users WHERE clerk_id = $1', [id]);
        if (existing) {
          await dbQuery(
            `UPDATE users SET
               email = $1, full_name = $2, phone = $3, updated_at = NOW()
             WHERE clerk_id = $4`,
            [primaryEmail, fullName, primaryPhone, id]
          );
          logger.info('Clerk user updated in DB', { clerkId: id });
        } else {
          // 2. Check if a legacy user with the same email exists — this is the
          //    "Upgrade to Clerk" path where a legacy JWT user is linking their
          //    existing account to a new Clerk identity. We match by email rather
          //    than clerk_id so the existing local record (farms, sensors, cycles,
          //    etc.) is preserved and just enriched with the Clerk ID.
          const legacyUser = await dbQueryOne<{ id: string }>(
            `SELECT id FROM users
             WHERE email = $1 AND auth_provider = 'legacy' AND clerk_id IS NULL
             LIMIT 1`,
            [primaryEmail]
          );

          if (legacyUser) {
            // Link the existing legacy user to this Clerk identity — preserves all
            // existing data (farms, crop cycles, sensor readings, etc.) while
            // upgrading the auth mechanism to Clerk.
            await dbQuery(
              `UPDATE users SET
                 clerk_id = $1, auth_provider = 'clerk',
                 full_name = $2, phone = $3, updated_at = NOW()
               WHERE id = $4`,
              [id, fullName, primaryPhone, legacyUser.id]
            );
            logger.info('Legacy user linked to Clerk identity', {
              legacyUserId: legacyUser.id, clerkId: id, email: primaryEmail
            });
          } else {
            // 3. No existing user found — create a fresh one (new Clerk sign-up)
            await dbQuery(
              `INSERT INTO users (clerk_id, email, full_name, phone, is_active, auth_provider)
               VALUES ($1, $2, $3, $4, true, 'clerk')
               ON CONFLICT (clerk_id) DO UPDATE SET
                 email = EXCLUDED.email, full_name = EXCLUDED.full_name,
                 phone = EXCLUDED.phone, updated_at = NOW()`,
              [id, primaryEmail, fullName, primaryPhone]
            );
            logger.info('Clerk user created in DB', { clerkId: id, email: primaryEmail });
          }
        }
        break;
      }

      case 'user.deleted': {
        const { id } = data;
        await dbQuery('UPDATE users SET is_active = false, updated_at = NOW() WHERE clerk_id = $1', [id]);
        logger.info('Clerk user deactivated in DB', { clerkId: id });
        break;
      }

      default:
        logger.debug('Clerk webhook: unhandled event type', { type });
    }

    res.status(200).json({ success: true });
  } catch (err: any) {
    logger.error('Clerk webhook verification failed', { error: err.message });
    return res.status(401).json({ success: false, message: 'Webhook verification failed' });
  }
});
