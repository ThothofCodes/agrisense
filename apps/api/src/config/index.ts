/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import dotenv from 'dotenv';
dotenv.config();

const opt = (key: string, fallback = ''): string =>
  process.env[key] ?? fallback;

export const config = {
  env: opt('NODE_ENV', 'development'),
  port: parseInt(opt('PORT', '3001'), 10),
  apiPrefix: '/api/v1',

  db: {
    host:     opt('DB_HOST', 'localhost'),
    port:     parseInt(opt('DB_PORT', '5432'), 10),
    database: opt('DB_NAME', 'agrisense'),
    user:     opt('DB_USER', 'agrisense'),
    password: opt('DB_PASSWORD', 'agrisense_secret'),
    ssl:      opt('DB_SSL', 'false') === 'true',
    max:      parseInt(opt('DB_POOL_MAX', '10'), 10),
    idleTimeoutMillis: 30000,
  },

  redis: {
    url:      opt('REDIS_URL', 'redis://localhost:6379'),
    password: opt('REDIS_PASSWORD', ''),
  },

  jwt: {
    accessSecret:  opt('JWT_ACCESS_SECRET',  'dev_access_secret_change_in_prod_min64chars_padding'),
    refreshSecret: opt('JWT_REFRESH_SECRET', 'dev_refresh_secret_change_in_prod_min64chars_padding'),
    accessExpires:  opt('JWT_ACCESS_EXPIRES',  '24h'),
    refreshExpires: opt('JWT_REFRESH_EXPIRES', '7d'),
  },

  mqtt: {
    host:     opt('MQTT_HOST', 'localhost'),
    port:     parseInt(opt('MQTT_PORT', '1883'), 10),
    username: opt('MQTT_USERNAME', 'agrisense'),
    password: opt('MQTT_PASSWORD', 'mqtt_secret'),
    clientId: opt('MQTT_CLIENT_ID', 'agrisense-api'),
  },

  clerk: {
    publishableKey: opt('VITE_CLERK_PUBLISHABLE_KEY', ''),
    secretKey:      opt('CLERK_SECRET_KEY', ''),
    webhookSecret:  opt('CLERK_WEBHOOK_SECRET', ''),
  },

  ml: {
    url:     opt('ML_SERVICE_URL', 'http://localhost:8000'),
    timeout: parseInt(opt('ML_SERVICE_TIMEOUT', '30000'), 10),
  },

  weather: {
    owmKey:        opt('OPENWEATHER_API_KEY', ''),
    owmUrl:        opt('OPENWEATHER_BASE_URL', 'https://api.openweathermap.org/data/2.5'),
    tomorrowKey:   opt('TOMORROW_IO_API_KEY', ''),
    tomorrowUrl:   opt('TOMORROW_IO_BASE_URL', 'https://api.tomorrow.io/v4'),
    nasaPowerUrl:  opt('NASA_POWER_BASE_URL', 'https://power.larc.nasa.gov/api/temporal/daily/point'),
  },

  sms: {
    apiKey:   opt('AT_API_KEY', ''),
    username: opt('AT_USERNAME', ''),
    senderId: opt('AT_SENDER_ID', 'AgriSense'),
    baseUrl:  opt('AT_BASE_URL', 'https://api.africastalking.com/version1'),
  },

  mpesa: {
    consumerKey:    opt('MPESA_CONSUMER_KEY', ''),
    consumerSecret: opt('MPESA_CONSUMER_SECRET', ''),
    shortcode:      opt('MPESA_SHORTCODE', '174379'),
    passkey:        opt('MPESA_PASSKEY', ''),
    callbackUrl:    opt('MPESA_CALLBACK_URL', 'http://localhost:3001/api/v1/payments/mpesa/callback'),
    env:            opt('MPESA_ENV', 'sandbox'),
  },

  security: {
    bcryptRounds:  parseInt(opt('BCRYPT_ROUNDS', '12'), 10),
    corsOrigin:    opt('CORS_ORIGIN', 'http://localhost:5173'),
    rateLimitWindowMs:    parseInt(opt('RATE_LIMIT_WINDOW_MS', '60000'), 10),
    rateLimitMax:         parseInt(opt('RATE_LIMIT_MAX_REQUESTS', '100'), 10),
    iotRateLimitMax:      parseInt(opt('IOT_RATE_LIMIT_MAX', '60'), 10), // per device_id, not per IP — see routes/sensors.ts
    authRateLimitMax:     parseInt(opt('AUTH_RATE_LIMIT_MAX', '5'), 10),
  },

  isDev: opt('NODE_ENV', 'development') === 'development',
  isProd: opt('NODE_ENV', 'development') === 'production',
};
