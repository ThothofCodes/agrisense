#!/usr/bin/env node
/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

/**
 * AgriSense DB Migration Runner
 * Usage: node scripts/migrate.js
 * Runs infrastructure/postgres/init.sql against configured DB
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function migrate() {
  const pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'agrisense',
    user:     process.env.DB_USER     || 'agrisense',
    password: process.env.DB_PASSWORD || 'agrisense_secret',
  });

  const dir = path.join(__dirname, '..', 'infrastructure', 'postgres');
  const files = ['001_init.sql', '002_v3_competitive_upgrades.sql', '003_quick_soil_check.sql', '004_clerk_integration.sql'];

  console.log('🌿 AgriSense — Running database migration...');
  let allOk = true;
  for (const file of files) {
    const sqlPath = path.join(dir, file);
    console.log(`  Running ${file}...`);
    try {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      await pool.query(sql);
      console.log(`  ✅ ${file} complete`);
    } catch (err) {
      // TimescaleDB functions may already exist — filter known-safe errors
      if (err.message.includes('already exists') || err.message.includes('hypertable')) {
        console.log(`  ℹ️  ${file} — some objects already existed (idempotent)`);
      } else {
        console.error(`  ❌ ${file} failed:`, err.message);
        allOk = false;
      }
    }
  }
  if (allOk) {
    console.log('✅ All migrations complete');
  } else {
    console.error('❌ Some migrations failed — see above');
    await pool.end();
    process.exit(1);
  }
  await pool.end();
}

migrate();
