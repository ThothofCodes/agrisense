/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ErrorCodes } from '../types';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFound(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: { code: 'AS-404', message: `Route ${req.method} ${req.path} not found` }
  });
}

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // Express detects error-handling middleware by function arity (4 params);
  // this parameter must stay even though it's unused in the body.
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, details: err.details }
    });
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        details: err.errors
      }
    });
  }

  // Postgres RAISE EXCEPTION from our validation triggers (e.g. AS-022 sensor
  // bounds, fired by validate_sensor_reading()) carries the AS-code in the
  // message text. This is the defense-in-depth backstop for any insertion
  // path that bypasses the Zod check above (MQTT bridge, future integrations).
  const asCodeMatch = /^(AS-\d{3}):\s*(.+)$/s.exec(err.message ?? '');
  if (asCodeMatch) {
    return res.status(400).json({
      success: false,
      error: { code: asCodeMatch[1], message: asCodeMatch[2] }
    });
  }

  // PostgreSQL errors
  if (err.code === '23505') {
    return res.status(409).json({
      success: false,
      error: { code: 'AS-409', message: 'Duplicate entry — resource already exists' }
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      success: false,
      error: { code: 'AS-400', message: 'Referenced resource not found' }
    });
  }

  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    success: false,
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message
    }
  });
}
