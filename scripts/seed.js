#!/usr/bin/env node
/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

/**
 * AgriSense Demo Seed Script
 * Creates a test user, farm, sensor nodes, and sample readings
 * Usage: node scripts/seed.js
 */
const axios = require('axios');

const API = process.env.API_URL || 'http://localhost:3001/api/v1';
let token = '';

async function post(path, body, auth = false) {
  const headers = auth ? { Authorization: `Bearer ${token}` } : {};
  const { data } = await axios.post(`${API}${path}`, body, { headers });
  return data.data;
}
async function get(path) {
  const { data } = await axios.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return data.data;
}

async function seed() {
  console.log('🌿 AgriSense Demo Seed Starting...\n');

  // 1. Register demo user
  let user, tokens;
  try {
    const r = await post('/auth/register', {
      email: 'demo@agrisense.io',
      password: 'DemoFarmer2026!',
      full_name: 'Demo Farmer',
      timezone: 'Africa/Nairobi',
    });
    user = r.user; tokens = r.tokens;
    console.log(`✅ Created user: ${user.email}`);
  } catch (e) {
    // Already exists — login
    const r = await post('/auth/login', { email: 'demo@agrisense.io', password: 'DemoFarmer2026!' });
    user = r.user; tokens = r.tokens;
    console.log(`ℹ️  User exists, logged in: ${user.email}`);
  }
  token = tokens.accessToken;

  // 2. Create demo farm (Nakuru, Kenya)
  const farm = await post('/farms', {
    name: 'Nakuru Demonstration Farm',
    latitude: -0.3031,
    longitude: 36.0800,
    total_area_ha: 12.5,
    county: 'Nakuru',
    country: 'Kenya',
    elevation_m: 1850,
    rainfall_zone: 'Sub-Humid',
    soil_type: 'Loam',
    season_zone: 'EAF',
  }, true);    console.log(`✅ Created farm: ${farm.farm.name} (${farm.farm.id})`);

  // 3. Register 3 sensor nodes
  const nodeIds = [];
  for (let i = 1; i <= 3; i++) {
    const node = await post('/sensors/register', {
      farm_id: farm.farm.id,
      device_id: `DEMO_NODE_00${i}`,
      name: `Field Node ${i}`,
      latitude: -0.3031 + (i * 0.001),
      longitude: 36.0800 + (i * 0.001),
      depth_cm: 15,
      capabilities: ['SOIL_PH','SOIL_MOISTURE','NITROGEN','PHOSPHORUS','POTASSIUM','SOIL_TEMP','ELECTRICAL_CONDUCTIVITY'],
    }, true);
    nodeIds.push(node.node.id);
    console.log(`✅ Registered sensor node: ${node.node.name}`);
  }

  // 4. Push 72h of sample sensor readings (every 15 min)
  console.log('\n📡 Injecting 3 days of sensor readings...');
  const readings = [];
  const sensors = [
    { type: 'SOIL_PH',               base: 6.4,  noise: 0.15, unit: 'pH'    },
    { type: 'SOIL_MOISTURE',          base: 62,   noise: 8,    unit: '%'     },
    { type: 'NITROGEN',               base: 22,   noise: 4,    unit: 'mg/kg' },
    { type: 'PHOSPHORUS',             base: 14,   noise: 2,    unit: 'mg/kg' },
    { type: 'POTASSIUM',              base: 128,  noise: 12,   unit: 'mg/kg' },
    { type: 'SOIL_TEMP',              base: 19,   noise: 2,    unit: '°C'   },
    { type: 'ELECTRICAL_CONDUCTIVITY',base: 0.4,  noise: 0.05, unit: 'dS/m' },
  ];

  const now = Date.now();
  for (const nodeId of nodeIds) {
    for (let h = 71; h >= 0; h--) {
      for (const s of sensors) {
        const value = +(s.base + (Math.random() - 0.5) * 2 * s.noise).toFixed(2);
        const time = new Date(now - h * 3600000).toISOString();
        readings.push({ nodeId, sensor_type: s.type, value, unit: s.unit, time });
      }
    }
  }

  // Push in batches of 20
  let pushed = 0;
  for (const nodeId of nodeIds) {
    const nodeReadings = readings.filter(r => r.nodeId === nodeId);
    for (let i = 0; i < nodeReadings.length; i += 20) {
      const batch = nodeReadings.slice(i, i + 20).map(r => ({
        sensor_type: r.sensor_type, value: r.value, unit: r.unit, time: r.time
      }));
      await post(`/sensors/${nodeId}/readings`, { readings: batch }, true);
      pushed += batch.length;
    }
  }
  console.log(`✅ Pushed ${pushed} sensor readings`);

  // 5. Start a crop cycle (Maize - Long Rains)
  const crops = await get('/crops');
  const maize = crops.crops.find((c) => c.name === 'Maize');
  if (maize) {
    const plantDate = new Date();
    plantDate.setDate(plantDate.getDate() - 45);
    await post('/cycles', {
      farm_id: farm.farm.id,
      crop_id: maize.id,
      planted_at: plantDate.toISOString().slice(0, 10),
    }, true);
    console.log(`✅ Started Maize crop cycle (planted 45 days ago)`);
  }

  console.log(`\n🌿 Seed complete!`);
  console.log(`   Dashboard: http://localhost:5173`);
  console.log(`   Login: demo@agrisense.io / DemoFarmer2026!`);
  console.log(`   Farm ID: ${farm.farm.id}`);
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.response?.data || err.message);
  process.exit(1);
});
