#!/usr/bin/env node
/**
 * AgriSense — Live Seed & End-to-End Proof Script
 * Run against the ACTUALLY RUNNING stack (not mocked). Creates:
 *   - 1 ADMIN account  (Ruai Tech Solutions / Thoth of Codes)
 *   - 1 FARMER account (demo smallholder, Ruai Town Centre context)
 * Then exercises every v3 competitive-insight feature live and prints proof.
 */
const axios = require('axios');
const { execSync } = require('child_process');

const API = process.env.API_URL || 'http://localhost:3001/api/v1';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function psql(sql) {
  return execSync(
    `PGPASSWORD=agrisense_secret psql -h localhost -U agrisense -d agrisense -t -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: 'utf8' }
  ).trim();
}

async function post(path, body, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const { data } = await axios.post(`${API}${path}`, body, { headers });
    return data.data;
  } catch (e) {
    return { __error: true, status: e.response?.status, body: e.response?.data };
  }
}
async function get(path, token) {
  try {
    const { data } = await axios.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    return data.data;
  } catch (e) {
    return { __error: true, status: e.response?.status, body: e.response?.data };
  }
}
async function patch(path, body, token) {
  try {
    const { data } = await axios.patch(`${API}${path}`, body, { headers: { Authorization: `Bearer ${token}` } });
    return data.data;
  } catch (e) {
    return { __error: true, status: e.response?.status, body: e.response?.data };
  }
}

const line = () => console.log('─'.repeat(72));
const section = (t) => { console.log(''); line(); console.log(`  ${t}`); line(); };

async function main() {
  section('🌿 AGRISENSE — LIVE SEED & END-TO-END PROOF');
  console.log(`API: ${API}`);
  console.log(`Time: ${new Date().toISOString()}`);

  // ───────────────────────────────────────────────────────────────────────
  section('1. ADMIN ACCOUNT — Ruai Tech Solutions');
  const ADMIN_EMAIL = 'admin@ruaitechsolutions.co.ke';
  const ADMIN_PASS  = 'RuaiTech!Admin2026';
  let admin = await post('/auth/register', {
    email: ADMIN_EMAIL, password: ADMIN_PASS,
    full_name: 'Thoth of Codes', phone: '+254700000001', timezone: 'Africa/Nairobi',
  });
  if (admin.__error) {
    console.log('   Already registered, logging in instead...');
    admin = await post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  }
  const adminToken = admin.tokens.accessToken;
  console.log(`✅ Admin user created: ${admin.user.email} (id: ${admin.user.id})`);

  // Promote to ADMIN role + ENTERPRISE tier. There is deliberately NO public
  // API path to do this — privilege escalation must happen out-of-band
  // (direct DB access during bootstrap), exactly as it would in production.
  psql(`UPDATE users SET role='ADMIN', tier='ENTERPRISE', data_sharing_consent=true, consent_updated_at=NOW() WHERE email='${ADMIN_EMAIL}';`);
  // Re-login to get a fresh token carrying the new role/tier claims
  admin = await post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS });
  const adminToken2 = admin.tokens.accessToken;
  console.log(`✅ Promoted to role=ADMIN, tier=ENTERPRISE`);
  console.log(`   Login: ${ADMIN_EMAIL} / ${ADMIN_PASS}`);

  // ───────────────────────────────────────────────────────────────────────
  section('2. FARMER ACCOUNT — Demo Smallholder');
  const FARMER_EMAIL = 'mwangi.farmer@agrisense.io';
  const FARMER_PASS  = 'Harvest2026!Safi';
  let farmer = await post('/auth/register', {
    email: FARMER_EMAIL, password: FARMER_PASS,
    full_name: 'John Mwangi', phone: '+254700000002', timezone: 'Africa/Nairobi',
  });
  if (farmer.__error) {
    farmer = await post('/auth/login', { email: FARMER_EMAIL, password: FARMER_PASS });
  }
  let farmerToken = farmer.tokens.accessToken;
  console.log(`✅ Farmer user created: ${farmer.user.email} (id: ${farmer.user.id})`);

  // Upgrade to FARMER subscription tier directly (in production this happens
  // via the M-Pesa STK Push callback in paymentService.ts — simulated here
  // since no real Safaricom sandbox credentials exist in this environment).
  psql(`UPDATE users SET tier='FARMER', tier_expires_at=NOW()+INTERVAL '31 days' WHERE email='${FARMER_EMAIL}';`);
  farmer = await post('/auth/login', { email: FARMER_EMAIL, password: FARMER_PASS });
  farmerToken = farmer.tokens.accessToken;
  console.log(`✅ Upgraded to tier=FARMER (simulates successful M-Pesa subscription)`);
  console.log(`   Login: ${FARMER_EMAIL} / ${FARMER_PASS}`);

  // ───────────────────────────────────────────────────────────────────────
  section('3. FARM — Ruai Town Centre (Ruai Tech Solutions home turf)');
  const farm = await post('/farms', {
    name: 'Ruai Demonstration Plot',
    latitude: -1.2864, longitude: 36.9450,   // Ruai, Nairobi
    total_area_ha: 3.2, county: 'Nairobi', country: 'Kenya',
    elevation_m: 1600, rainfall_zone: 'Sub-Humid', soil_type: 'Loam', season_zone: 'EAF',
  }, farmerToken);
  console.log(`✅ Farm created: "${farm.farm.name}" (${farm.farm.id})`);
  console.log(`   ${farm.farm.total_area_ha} ha at ${farm.farm.latitude}, ${farm.farm.longitude}`);

  // ───────────────────────────────────────────────────────────────────────
  section('4. SENSOR NODE — registration + automated location-error check');
  const node = await post('/sensors/register', {
    farm_id: farm.farm.id, device_id: `RUAI_NODE_${Date.now()}`,
    name: 'Field Node A', latitude: -1.2860, longitude: 36.9455, depth_cm: 15,
    capabilities: ['SOIL_PH','SOIL_MOISTURE','NITROGEN','PHOSPHORUS','POTASSIUM','SOIL_TEMP','ELECTRICAL_CONDUCTIVITY'],
  }, farmerToken);
  console.log(`✅ Sensor node registered: ${node.node.name} (trust_score: ${node.node.trust_score})`);

  // Register a SECOND node deliberately 50km away to prove the Climate
  // FieldView-inspired location-anomaly detector fires for real.
  const badNode = await post('/sensors/register', {
    farm_id: farm.farm.id, device_id: `RUAI_NODE_BADGPS_${Date.now()}`,
    name: 'Field Node B (GPS fault test)', latitude: -0.8, longitude: 36.95, depth_cm: 15,
    capabilities: ['SOIL_PH'],
  }, farmerToken);
  console.log(`   Test node 50km away → location_flag: ${badNode.node.location_flag} (should be true)`);

  // ───────────────────────────────────────────────────────────────────────
  section('5. FOOD-SECURITY VALIDATION — proving the bounds trigger live');
  const badReading = await post(`/sensors/${node.node.id}/readings`,
    { sensor_type: 'SOIL_PH', value: 22, unit: 'pH' }, farmerToken);
  console.log(`   Submitted impossible pH=22 → HTTP ${badReading.status}: ${badReading.body?.error?.code} — ${badReading.body?.error?.message?.slice(0, 90)}...`);
  console.log(`   ${badReading.__error && badReading.status === 400 ? '✅ CORRECTLY REJECTED' : '❌ SHOULD HAVE BEEN REJECTED'}`);

  const goodReadings = await post(`/sensors/${node.node.id}/readings`, {
    readings: [
      { sensor_type: 'SOIL_PH', value: 6.4, unit: 'pH' },
      { sensor_type: 'SOIL_MOISTURE', value: 64, unit: '%' },
      { sensor_type: 'NITROGEN', value: 24, unit: 'mg/kg' },
      { sensor_type: 'PHOSPHORUS', value: 15, unit: 'mg/kg' },
      { sensor_type: 'POTASSIUM', value: 135, unit: 'mg/kg' },
      { sensor_type: 'SOIL_TEMP', value: 19.5, unit: '°C' },
      { sensor_type: 'ELECTRICAL_CONDUCTIVITY', value: 0.4, unit: 'dS/m' },
    ]
  }, farmerToken);
  console.log(`✅ 7 valid readings accepted. Node trust_score now: ${goodReadings.node_trust_score}`);

  // ───────────────────────────────────────────────────────────────────────
  section('6. SOIL FEASIBILITY SCORE — trust-weighted confidence');
  const sfs = await get(`/sfs/${farm.farm.id}`, farmerToken);
  console.log(`✅ SFS = ${sfs.sfs.total_score}/100 (${sfs.sfs.interpretation})`);
  console.log(`   Data completeness: ${sfs.data_completeness_pct}% | Avg sensor trust: ${sfs.avg_sensor_trust_score}`);
  console.log(`   Components: pH=${sfs.sfs.ph_score} N=${sfs.sfs.nitrogen_score} P=${sfs.sfs.phosphorus_score} K=${sfs.sfs.potassium_score} Moisture=${sfs.sfs.moisture_score} EC=${sfs.sfs.ec_score} Temp=${sfs.sfs.soil_temp_score} OM=${sfs.sfs.organic_matter_score} (stale=${sfs.sfs.om_stale})`);

  // ───────────────────────────────────────────────────────────────────────
  section('7. WEATHER ENSEMBLE — multi-source forecast');
  const weather = await get(`/weather/${farm.farm.id}/forecast?days=5`, farmerToken);
  if (weather.__error) {
    console.log(`   ⚠️  No weather API keys configured in this sandbox (expected — see .env.example). Forecast unavailable: ${weather.body?.error?.message}`);
  } else {
    console.log(`✅ ${weather.forecast.length}-day forecast retrieved`);
    weather.forecast.slice(0, 3).forEach(d => console.log(`   ${d.date}: ${d.temp_min}–${d.temp_max}°C, ${d.rainfall_mm}mm rain${d.low_confidence ? ' ⚠️ LOW CONFIDENCE (sources disagree)' : ''}`));
  }

  // ───────────────────────────────────────────────────────────────────────
  section('8. CROP CYCLE + PROACTIVE GDD-DEFICIT CHECK');
  const crops = await get('/crops', farmerToken);
  const maize = crops.crops.find(c => c.name === 'Maize');
  const plantDate = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
  const cycle = await post('/cycles', { farm_id: farm.farm.id, crop_id: maize.id, planted_at: plantDate }, farmerToken);
  console.log(`✅ Maize cycle started, planted ${plantDate} (45 days ago)`);
  const gdd = await get(`/cycles/${cycle.cycle.id}/gdd`, farmerToken);
  console.log(`   GDD accumulated: ${gdd.gdd.gdd_cumulative} | Stage: ${gdd.gdd.current_stage} | Days to harvest: ${gdd.gdd.days_to_harvest}`);

  // ───────────────────────────────────────────────────────────────────────
  section('9. AI ADVISOR — confidence-gated recommendations');
  const recs = await post('/recommendations/crops', { farm_id: farm.farm.id }, farmerToken);
  if (recs.__error) {
    console.log(`   ❌ ${recs.status}: ${recs.body?.error?.message}`);
  } else {
    console.log(`✅ Top recommendation: ${recs.recommendations[0].crop_name} (score ${recs.recommendations[0].score}, confidence ${recs.recommendations[0].confidence})`);
    console.log(`   Data completeness: ${recs.data_completeness_pct}% | Avg trust: ${recs.avg_sensor_trust_score} | Requires agronomist review: ${recs.requires_agronomist_review}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  section('10. TREATMENT / SPRAY DIARY (Plantix-inspired)');
  const treatment = await post('/treatments', {
    farm_id: farm.farm.id, crop_cycle_id: cycle.cycle.id,
    treatment_type: 'FERTILISER', product_name: 'CAN (Calcium Ammonium Nitrate)',
    application_rate: 50, rate_unit: 'kg/ha', pre_harvest_interval_days: 0,
    notes: 'Top-dress nitrogen application at knee-high stage',
  }, farmerToken);
  console.log(`✅ Treatment logged: ${treatment.treatment.product_name} (${treatment.treatment.treatment_type})`);

  const pesticide = await post('/treatments', {
    farm_id: farm.farm.id, crop_cycle_id: cycle.cycle.id,
    treatment_type: 'PESTICIDE', product_name: 'Cypermethrin 10% EC',
    application_rate: 1.5, rate_unit: 'L/ha', pre_harvest_interval_days: 14,
    notes: 'Armyworm outbreak treatment',
  }, farmerToken);
  console.log(`✅ Pesticide logged with 14-day PHI`);

  const phiCheck = await get(`/treatments/phi-check/${cycle.cycle.id}`, farmerToken);
  console.log(`   PHI compliance check → safe to harvest now: ${phiCheck.safe_to_harvest} (earliest safe: ${phiCheck.earliest_safe_harvest})`);

  // ───────────────────────────────────────────────────────────────────────
  section('11. PHOTO DIAGNOSIS QUEUE (Plantix-inspired, honest architecture)');
  const diagnosis = await post('/diagnoses', {
    farm_id: farm.farm.id, crop_cycle_id: cycle.cycle.id,
    image_ref: 'https://storage.agrisense.io/demo/leaf_sample_001.jpg',
    image_size_bytes: 2_400_000,
    symptom_tags: ['yellow leaves', 'holes in leaves'],
  }, farmerToken);
  console.log(`✅ Photo submitted → status: ${diagnosis.diagnosis.status}`);
  console.log(`   "${diagnosis.message}"`);

  // Admin reviews it
  const reviewed = await patch(`/diagnoses/${diagnosis.diagnosis.id}/review`, {
    agronomist_notes: 'Consistent with early-stage fall armyworm damage. Recommend Bt-based biological control before chemical escalation.',
  }, adminToken2);
  console.log(`✅ Admin (agronomist role) reviewed → status: ${reviewed.diagnosis.status}`);

  // ───────────────────────────────────────────────────────────────────────
  section('12. TRUSTED-ADVISOR SHARING (Climate FieldView-inspired)');
  const share = await post('/shares', { farm_id: farm.farm.id, role: 'AGRONOMIST' }, farmerToken);
  console.log(`✅ Share token issued: ${share.share.token}`);
  console.log(`   Expires: ${share.share.expires_at}`);
  const accept = await post(`/shares/${share.share.token}/accept`, {}, adminToken2);
  console.log(`✅ Admin accepted share → role: ${accept.share.role}, accepted_at: ${accept.share.accepted_at}`);

  // ───────────────────────────────────────────────────────────────────────
  section('13. ALERTS CENTRE — what fired during this run');
  const alerts = await get(`/alerts?farm_id=${farm.farm.id}`, farmerToken);
  console.log(`✅ ${alerts.alerts.length} alert(s) on this farm:`);
  alerts.alerts.forEach(a => console.log(`   [${a.severity}] ${a.title}`));

  // ───────────────────────────────────────────────────────────────────────
  section('✅ LIVE SEED COMPLETE');
  console.log(`
  ADMIN     ${ADMIN_EMAIL} / ${ADMIN_PASS}
  FARMER    ${FARMER_EMAIL} / ${FARMER_PASS}
  FARM_ID   ${farm.farm.id}
  API       ${API}
  `);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
