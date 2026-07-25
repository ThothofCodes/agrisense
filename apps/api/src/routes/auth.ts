/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { dbQuery, dbQueryOne } from '../db';
import { config } from '../config';
import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { User, AuthTokens, JwtPayload, ErrorCodes } from '../types';
import { logger } from '../utils/logger';

export const authRouter = Router();

const registerSchema = z.object({
  email:     z.string().email(),
  password:  z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().min(2),
  phone:     z.string().optional(),
  timezone:  z.string().optional(),
});

const loginSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

function generateTokens(user: User): AuthTokens {
  const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
    sub:   user.id,
    email: user.email,
    role:  user.role,
    tier:  user.tier,
  };
  const accessToken = jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpires as any,
  });
  const refreshToken = jwt.sign(
    { sub: user.id, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpires as any }
  );
  return { accessToken, refreshToken, expiresIn: 86400 };
}

// POST /auth/register
authRouter.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await dbQueryOne('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing) {
      throw new AppError(409, 'AS-409', 'Email already registered');
    }
    const passwordHash = await bcrypt.hash(body.password, config.security.bcryptRounds);
    const [user] = await dbQuery<User>(
      `INSERT INTO users (email, password_hash, full_name, phone, timezone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, email, full_name, phone, role, tier, language, timezone, mfa_enabled, is_active, created_at`,
      [body.email, passwordHash, body.full_name, body.phone ?? null, body.timezone ?? 'Africa/Nairobi']
    );
    const tokens = generateTokens(user);
    logger.info('New user registered', { userId: user.id, email: user.email });
    res.status(201).json({ success: true, data: { user, tokens } });
  } catch (err) { next(err); }
});

// POST /auth/login
authRouter.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const user = await dbQueryOne<User & { password_hash: string }>(
      `SELECT id, email, password_hash, full_name, phone, role, tier, tier_expires_at,
              language, timezone, mfa_enabled, is_active, created_at
       FROM users WHERE email = $1`,
      [body.email]
    );
    if (!user || !user.is_active) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    const valid = await bcrypt.compare(body.password, user.password_hash);
    if (!valid) {
      throw new AppError(401, ErrorCodes.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    await dbQuery('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    // Destructured specifically to STRIP password_hash before this object
    // is ever sent in an HTTP response — the exclusion is the whole point.
    const { password_hash: _password_hash, ...safeUser } = user;
    const tokens = generateTokens(safeUser as User);
    logger.info('User logged in', { userId: user.id });
    res.json({ success: true, data: { user: safeUser, tokens } });
  } catch (err) { next(err); }
});

// POST /auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new AppError(400, ErrorCodes.TOKEN_INVALID, 'Refresh token required');
    let decoded: any;
    try {
      decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    } catch {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'Invalid refresh token');
    }
    const user = await dbQueryOne<User>(
      'SELECT id, email, role, tier, is_active FROM users WHERE id = $1',
      [decoded.sub]
    );
    if (!user || !user.is_active) {
      throw new AppError(401, ErrorCodes.TOKEN_INVALID, 'User not found or inactive');
    }
    const tokens = generateTokens(user);
    res.json({ success: true, data: { tokens } });
  } catch (err) { next(err); }
});

// GET /auth/me
authRouter.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await dbQueryOne<User>(
      `SELECT id, email, full_name, phone, role, tier, tier_expires_at,
              language, timezone, mfa_enabled, last_login_at, is_active, created_at,
              data_sharing_consent, consent_updated_at,
              clerk_id, auth_provider
       FROM users WHERE id = $1`,
      [req.user!.sub]
    );
    if (!user) throw new AppError(404, ErrorCodes.FARM_NOT_FOUND, 'User not found');
    res.json({ success: true, data: { user } });
  } catch (err) { next(err); }
});

// POST /auth/logout
authRouter.post('/logout', authenticate, (req: Request, res: Response) => {
  // In a stateless JWT setup, logout is handled client-side.
  // For enhanced security, add token to a Redis blacklist here.
  res.json({ success: true, data: { message: 'Logged out successfully' } });
});
