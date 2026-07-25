/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { config } from '../config';
import { JwtPayload, UserRole, SubscriptionTier, ErrorCodes } from '../types';
import { dbQueryOne } from '../db';

declare global {
  // Standard TypeScript pattern for augmenting Express's Request type via
  // declaration merging — see .eslintrc.cjs for why `no-namespace` is off.
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const CLERK_ENABLED = !!(config.clerk.secretKey && config.clerk.publishableKey);
const clerkClient = CLERK_ENABLED
  ? createClerkClient({ secretKey: config.clerk.secretKey })
  : null;

interface ClerkJwtPayload {
  sub: string;
  email?: string;
  amr?: string[];
  [key: string]: any;
}

/**
 * Attempt to verify a JWT using Clerk's JWKS endpoint. Falls back to the legacy
 * local JWT secret when Clerk is not configured.
 */
async function verifyToken(token: string): Promise<JwtPayload | null> {
  // Try Clerk first (when configured)
  if (CLERK_ENABLED && clerkClient) {
    try {
      const clerkPayload = await clerkClient.verifyToken(token);
      const payload = clerkPayload as ClerkJwtPayload;
      return {
        sub:   payload.sub,
        email: payload.email ?? '',
        role:  'BASIC' as UserRole,
        tier:  'FREE' as SubscriptionTier,
        amr:   payload.amr,
      };
    } catch {
      // Clerk verification failed — fall through to legacy JWT check
    }
  }

  // Fall back to legacy local JWT verification
  try {
    const localPayload = jwt.verify(token, config.jwt.accessSecret) as JwtPayload;
    return localPayload;
  } catch {
    return null;
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({
      success: false,
      error: { code: ErrorCodes.TOKEN_INVALID, message: 'Authentication required' }
    });
  }

  try {
    const user = await verifyToken(token);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: { code: ErrorCodes.TOKEN_INVALID, message: 'Invalid or expired token' }
      });
    }
    req.user = user;
    next();
  } catch (err: any) {
    return res.status(401).json({
      success: false,
      error: { code: ErrorCodes.TOKEN_EXPIRED, message: 'Invalid or expired token' }
    });
  }
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: ErrorCodes.TOKEN_INVALID, message: 'Not authenticated' } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: { code: ErrorCodes.FORBIDDEN, message: 'Insufficient role' } });
    }
    next();
  };
}

export function requireTier(...tiers: SubscriptionTier[]) {
  const tierRank: Record<SubscriptionTier, number> = {
    FREE: 0, FARMER: 1, PROFESSIONAL: 2, ENTERPRISE: 3
  };
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: { code: ErrorCodes.TOKEN_INVALID, message: 'Not authenticated' } });
    }
    const userRank = tierRank[req.user.tier];
    const requiredRank = Math.min(...tiers.map(t => tierRank[t]));
    if (userRank < requiredRank) {
      return res.status(403).json({
        success: false,
        error: { code: ErrorCodes.SUBSCRIPTION_EXPIRED, message: `This feature requires ${tiers[0]} tier or above` }
      });
    }
    next();
  };
}

/**
 * Middleware that requires MFA (multi-factor authentication) for the current
 * request. Only applies when:
 *   1. The user has `mfa_enabled = true` in the local users table
 *   2. Clerk authentication is active (Clerk provides the `amr` claim)
 *
 * When both conditions are met, the middleware checks the Clerk session JWT's
 * `amr` (Authentication Methods Reference) claim. Clerk sets `amr: ["mfa"]`
 * when the user completed an MFA step during authentication. If MFA is missing,
 * the request is rejected with AS-005 (MFA_REQUIRED) and a 403 status.
 *
 * Legacy JWT users (non-Clerk) bypass MFA enforcement gracefully — the
 * `mfa_enabled` field still exists but is only enforced through Clerk's MFA.
 */
export function requireMfa() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: { code: ErrorCodes.TOKEN_INVALID, message: 'Not authenticated' }
      });
    }

    // Skip MFA check for legacy JWT users (no Clerk -> no amr claim)
    if (!CLERK_ENABLED) {
      return next();
    }

    try {
      // Check if the user has MFA enabled in their local profile
      const user = await dbQueryOne<{ mfa_enabled: boolean }>(
        'SELECT mfa_enabled FROM users WHERE id = $1',
        [req.user.sub]
      );

      // If MFA is not enabled for this user, no check needed
      if (!user?.mfa_enabled) {
        return next();
      }

      // MFA is enabled — verify the Clerk session JWT includes 'mfa' in its amr claim
      const amr = req.user.amr;
      if (!amr || !amr.includes('mfa')) {
        return res.status(403).json({
          success: false,
          error: {
            code: ErrorCodes.MFA_REQUIRED,
            message: 'Multi-factor authentication required for this operation. Please re-authenticate with MFA.',
          }
        });
      }

      next();
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Failed to verify MFA status' }
      });
    }
  };
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (token) {
    try {
      const user = await verifyToken(token);
      if (user) req.user = user;
    } catch { /* ignore */ }
  }
  next();
}
