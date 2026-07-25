/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import winston from 'winston';
import { config } from '../config';

export const logger = winston.createLogger({
  level: config.isDev ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    config.isDev
      ? winston.format.colorize()
      : winston.format.json()
  ),
  defaultMeta: { service: 'agrisense-api' },
  transports: [
    new winston.transports.Console({
      format: config.isDev
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
              const metaStr = Object.keys(meta).length
                ? ' ' + JSON.stringify(meta)
                : '';
              return `${timestamp} [${level}] ${message}${metaStr}`;
            })
          )
        : winston.format.json(),
    }),
  ],
});
