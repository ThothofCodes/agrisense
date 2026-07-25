/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { createClient } from 'redis';
import { config } from '../config';
import { logger } from '../utils/logger';

export const redisClient = createClient({
  url: config.redis.url,
  ...(config.redis.password ? { password: config.redis.password } : {}),
});

redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.on('reconnecting', () => logger.warn('Redis reconnecting'));

export async function connectRedis() {
  await redisClient.connect();
}

export async function checkRedisConnection(): Promise<boolean> {
  try {
    await redisClient.ping();
    return true;
  } catch { return false; }
}
