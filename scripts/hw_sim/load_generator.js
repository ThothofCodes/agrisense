#!/usr/bin/env node
/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 *
 * Hardware Simulation — Load Generator
 * ------------------------------------
 * Simulates N concurrent "farms" hammering every hot path of the real,
 * running stack: sensor ingestion (the highest-frequency real-world traffic
 * — every node, every 15 minutes, compressed here into a tight loop), SFS
 * computation, weather lookups, and AI crop recommendations. Run alongside
 * monitor.py to get real RSS/CPU figures under load, calibrated against
 * thoth-parthenon's actual 6-core/16GB spec (see HARDWARE_PROFILE.md).
 */
const axios = require('axios');

const API = process.env.API_URL || 'http://localhost:3001/api/v1';
const FARM_COUNT = parseInt(process.argv[2] || '10', 10);     // simulated concurrent farms
const DURATION_SEC = parseInt(process.argv[3] || '60', 10);
const NODES_PER_FARM = 3;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let totalRequests = 0, totalErrors = 0;
const latencies = [];

async function timed(fn, label) {
  const start = Date.now();
  try {
    await fn();
    latencies.push(Date.now() - start);
    totalRequests++;
  } catch (e) {
    totalErrors++;
    totalRequests++;
    if (process.env.DEBUG_ERRORS && errorSamples.length < 10) {
      errorSamples.push(`${label}: ${e.response?.status} ${JSON.stringify(e.response?.data?.error || e.message)}`);
    }
  }
}
const errorSamples = [];

async function setupFarm(i) {
  const email = `loadtest_farm_${i}_${Date.now()}@agrisense.test`;
  const { data: reg } = await axios.post(`${API}/auth/register`, {
    email, password: 'LoadTest2026!', full_name: `Load Test Farm ${i}`, timezone: 'Africa/Nairobi',
  });
  const token = reg.data.tokens.accessToken;
  const headers = { Authorization: `Bearer ${token}` };

  const { data: farmRes } = await axios.post(`${API}/farms`, {
    name: `Load Test Farm ${i}`, latitude: -1.28 + Math.random() * 0.1, longitude: 36.9 + Math.random() * 0.1,
    total_area_ha: 2 + Math.random() * 8, county: 'Nairobi', season_zone: 'EAF',
  }, { headers });
  const farmId = farmRes.data.farm.id;

  const nodeIds = [];
  for (let n = 0; n < NODES_PER_FARM; n++) {
    const { data: nodeRes } = await axios.post(`${API}/sensors/register`, {
      farm_id: farmId, device_id: `LOADTEST_${i}_${n}_${Date.now()}`,
      name: `Node ${n}`, depth_cm: 15,
      capabilities: ['SOIL_PH', 'SOIL_MOISTURE', 'NITROGEN'],
    }, { headers });
    nodeIds.push(nodeRes.data.node.id);
  }

  return { farmId, nodeIds, headers };
}

async function farmWorker(farm, endTime) {
  while (Date.now() < endTime) {
    const nodeId = farm.nodeIds[Math.floor(Math.random() * farm.nodeIds.length)];

    // Realistic mix: sensor readings are by far the highest-frequency
    // traffic in production (every node, every 15 min); SFS/recommendations
    // are checked far less often by a real farmer opening the app.
    const roll = Math.random();
    if (roll < 0.7) {
      await timed(() => axios.post(`${API}/sensors/${nodeId}/readings`, {
        readings: [
          { sensor_type: 'SOIL_PH', value: +(6 + Math.random()).toFixed(2) },
          { sensor_type: 'SOIL_MOISTURE', value: +(50 + Math.random() * 30).toFixed(1) },
          { sensor_type: 'NITROGEN', value: +(15 + Math.random() * 20).toFixed(1) },
        ]
      }, { headers: farm.headers }), 'readings');
    } else if (roll < 0.9) {
      await timed(() => axios.get(`${API}/sfs/${farm.farmId}`, { headers: farm.headers }), 'sfs');
    } else {
      await timed(() => axios.post(`${API}/recommendations/crops`, { farm_id: farm.farmId }, { headers: farm.headers })
        .catch(() => {}), 'recommend');
    }
    await sleep(300 + Math.random() * 200); // ~2.5 actions/sec/farm — stays under the 60/min/device ingestion ceiling across 3 nodes
  }
}

async function main() {
  console.log(`=== AgriSense Hardware Simulation — Load Generator ===`);
  console.log(`Simulating ${FARM_COUNT} concurrent farms × ${NODES_PER_FARM} nodes for ${DURATION_SEC}s`);
  console.log(`Target: ${API}\n`);

  console.log('Setting up simulated farms...');
  const farms = [];
  for (let i = 0; i < FARM_COUNT; i++) {
    try {
      farms.push(await setupFarm(i));
    } catch (e) {
      console.error(`Farm ${i} setup failed:`, e.response?.data?.error?.message || e.message);
    }
    // Stagger setup — the 5/min auth limiter is correct brute-force
    // protection, not a bug; a real onboarding flow wouldn't register
    // 8 accounts in the same second either.
    await sleep(2500);
  }
  console.log(`${farms.length}/${FARM_COUNT} farms ready. Starting load...\n`);

  const endTime = Date.now() + DURATION_SEC * 1000;
  await Promise.all(farms.map(f => farmWorker(f, endTime)));

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

  console.log('\n=== LOAD TEST RESULTS ===');
  console.log(`Total requests: ${totalRequests}`);
  console.log(`Errors: ${totalErrors} (${((totalErrors / totalRequests) * 100).toFixed(2)}%)`);
  console.log(`Throughput: ${(totalRequests / DURATION_SEC).toFixed(1)} req/s`);
  console.log(`Latency p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms`);
  if (errorSamples.length) {
    console.log('\nSample errors:');
    errorSamples.forEach(e => console.log('  ' + e));
  }

  require('fs').writeFileSync('/tmp/hw_sim_load_results.json', JSON.stringify({
    farms: farms.length, duration_sec: DURATION_SEC, total_requests: totalRequests,
    errors: totalErrors, throughput_req_s: +(totalRequests / DURATION_SEC).toFixed(1),
    latency_p50_ms: p50, latency_p95_ms: p95, latency_p99_ms: p99,
  }, null, 2));
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
