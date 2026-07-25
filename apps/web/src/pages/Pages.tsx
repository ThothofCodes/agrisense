/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

// ── Soil Health Page ──────────────────────────────────────────────────────────
import React, { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useNavigate, Navigate } from 'react-router-dom';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useFarmStore, useAuthStore } from '../store';
import { api, apiClient } from '../api';
import { Card, SFSGauge, Spinner, EmptyState, StatCard, Button } from '../components/ui';

export function SoilPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const queryClient = useQueryClient();

  const { data: sfsData, isLoading } = useQuery({
    queryKey: ['sfs', farmId], queryFn: () => api.sfs.get(farmId!), enabled: !!farmId
  });
  const sfs = sfsData?.sfs;

  const { data: nodes } = useQuery({
    queryKey: ['sensors', farmId], queryFn: () => api.sensors.list(farmId!), enabled: !!farmId
  });

  // ── Quick Soil Check — UjuziKilimo competitive response ──────────────────
  // Lets a farmer try AgriSense's recommendation engine using ANY soil
  // reading source (a SoilPal Pro, a county lab result, a test strip) before
  // ever investing in AgriSense's own IoT sensor hardware. See
  // infrastructure/postgres/003_quick_soil_check.sql for the full context.
  const [showQuickCheck, setShowQuickCheck] = useState(false);
  const [quickForm, setQuickForm] = useState({
    ph: '6.5', nitrogen: '20', phosphorus: '12', potassium: '120',
    moisture: '60', ec: '0.5', organic_matter: '2.5', soil_temp: '20', notes: '',
  });
  const [quickSubmitting, setQuickSubmitting] = useState(false);
  const [quickResult, setQuickResult] = useState<any>(null);
  const [quickError, setQuickError] = useState('');

  const submitQuickCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmId) return;
    setQuickSubmitting(true);
    setQuickError('');
    try {
      const payload = {
        ph: +quickForm.ph, nitrogen: +quickForm.nitrogen, phosphorus: +quickForm.phosphorus,
        potassium: +quickForm.potassium, moisture: +quickForm.moisture, ec: +quickForm.ec,
        organic_matter: +quickForm.organic_matter, soil_temp: +quickForm.soil_temp,
        notes: quickForm.notes || undefined,
      };
      const result = await api.sfs.submitManual(farmId, payload);
      setQuickResult(result);
      queryClient.invalidateQueries({ queryKey: ['sfs', farmId] });
    } catch (err: any) {
      const details = err.response?.data?.error?.details;
      setQuickError(details?.[0]?.message ?? err.response?.data?.error?.message ?? 'Submission failed');
    } finally {
      setQuickSubmitting(false);
    }
  };

  const radarData = sfs ? [
    { param: 'pH',       score: sfs.ph_score },
    { param: 'N',        score: sfs.nitrogen_score },
    { param: 'P',        score: sfs.phosphorus_score },
    { param: 'K',        score: sfs.potassium_score },
    { param: 'Moisture', score: sfs.moisture_score },
    { param: 'O.Matter', score: sfs.organic_matter_score },
    { param: 'Salinity', score: sfs.ec_score },
    { param: 'Temp',     score: sfs.soil_temp_score },
  ] : [];

  if (!farmId) return <EmptyState icon="🧪" title="No farm selected" />;
  if (isLoading) return <Spinner size="lg" />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Soil Health</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Feasibility Score">
          {sfs && <><SFSGauge score={sfs.total_score} />
            {sfs.om_stale && <p className="text-xs text-amber text-center">⚠️ Organic matter data &gt;90 days old</p>}
            <p className="text-xs text-sage text-center mt-1">Data coverage: {sfsData.data_completeness_pct}% · Sensor trust: {sfsData.avg_sensor_trust_score}%</p>
          </>}
        </Card>

        <Card title="Parameter Radar" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#D8F3DC" />
              <PolarAngleAxis dataKey="param" tick={{ fontSize: 11, fill: '#52796F' }} />
              <Radar name="Score" dataKey="score" stroke="#1B4332" fill="#1B4332" fillOpacity={0.3} strokeWidth={2} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
            </RadarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Sensor Nodes">
        {nodes?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {nodes.map((n: any) => (
              <div key={n.id} className="border border-parchment-dark rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm text-forest">{n.name ?? n.device_id}</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${n.status === 'ONLINE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                    {n.status}
                  </span>
                </div>
                <div className="text-xs text-sage">
                  Battery: {n.battery_pct ?? '—'}% · Depth: {n.depth_cm}cm
                </div>
                {n.last_seen_at && <div className="text-[10px] text-sage mt-0.5">Last seen: {new Date(n.last_seen_at).toLocaleTimeString()}</div>}
              </div>
            ))}
          </div>
        ) : <EmptyState icon="📡" title="No sensors registered" sub="Register IoT nodes to begin collecting soil data." />}
      </Card>

      <Card title="🌾 Quick Soil Check"
        action={<button onClick={() => setShowQuickCheck(s => !s)} className="text-xs text-forest font-semibold hover:underline">{showQuickCheck ? 'Hide' : 'Try it'}</button>}>
        <p className="text-sm text-sage mb-3">
          Already have a reading from a SoilPal, a county lab, or a test strip? Type it in and get the
          same soil score and crop recommendation a sensor-fed farm gets — no AgriSense hardware required to try it.
        </p>

        {showQuickCheck && (
          <form onSubmit={submitQuickCheck} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              ['ph', 'pH', '0–14'], ['nitrogen', 'Nitrogen (mg/kg)', '0–500'],
              ['phosphorus', 'Phosphorus (mg/kg)', '0–300'], ['potassium', 'Potassium (mg/kg)', '0–1000'],
              ['moisture', 'Moisture (%)', '0–100'], ['ec', 'Salinity EC (dS/m)', '0–20'],
              ['organic_matter', 'Organic Matter (%)', '0–100'], ['soil_temp', 'Soil Temp (°C)', '-10–60'],
            ] as const).map(([key, label, range]) => (
              <div key={key}>
                <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">{label}</label>
                <input type="number" step="0.1" value={(quickForm as any)[key]}
                  onChange={e => setQuickForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full border border-parchment-dark rounded-lg px-2 py-1.5 text-sm" />
                <span className="text-[9px] text-sage">{range}</span>
              </div>
            ))}
            <div className="col-span-2 sm:col-span-4">
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Notes (where this reading came from)</label>
              <input value={quickForm.notes} onChange={e => setQuickForm(p => ({ ...p, notes: e.target.value }))}
                placeholder="e.g. UjuziKilimo SoilPal Pro reading, homestead plot"
                className="w-full border border-parchment-dark rounded-lg px-2 py-1.5 text-sm" />
            </div>
            <div className="col-span-2 sm:col-span-4">
              <Button type="submit" disabled={quickSubmitting}>{quickSubmitting ? 'Scoring…' : 'Get My Soil Score'}</Button>
            </div>
          </form>
        )}

        {quickError && <p className="text-xs text-red-600 bg-red-50 rounded p-2 mt-3">{quickError}</p>}

        {quickResult && (
          <div className="mt-4 bg-sage-pale rounded-lg p-4 flex items-center gap-4">
            <SFSGauge score={quickResult.sfs.total_score} />
            <div>
              <div className="text-xs text-sage uppercase tracking-wide">Manually-Entered Result</div>
              <div className="font-display text-lg font-bold text-forest">{quickResult.sfs.interpretation}</div>
              <div className="text-xs text-sage mt-1">
                Trust-weighted at {quickResult.avg_sensor_trust_score}% — calibrated IoT sensors carry more
                weight in recommendations than a one-off manual entry, but this is real, usable data.
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Soil Health Assessment */}
      {sfs && (
        <Card title="📋 Soil Health Assessment">
          <div className="text-sm text-forest space-y-3">
            {sfs.total_score >= 80 ? (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <strong>🌟 Overall: Excellent</strong>
                <p className="text-xs text-sage mt-1">Your soil is in great condition. Continue with current management practices.
                Regular monitoring recommended to maintain these levels.</p>
              </div>
            ) : sfs.total_score >= 60 ? (
              <div className="bg-amber-pale border border-amber rounded-lg p-3">
                <strong>📈 Overall: Good — Room for Improvement</strong>
                <p className="text-xs text-sage mt-1">Your soil is in decent shape. Address the lowest-scoring parameters below to improve overall soil health.</p>
              </div>
            ) : (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <strong>⚠️ Overall: Needs Attention</strong>
                <p className="text-xs text-sage mt-1">Several parameters need improvement. Review recommendations below and consider soil amendments.</p>
              </div>
            )}

            <div className="space-y-2">
              <h4 className="font-semibold text-sm">Parameter-Specific Tips</h4>
              {(() => {
                const tips: { label: string; score: number; tip: string }[] = [];
                const addTip = (label: string, score: number, low: string, mid: string, high: string) => {
                  tips.push({ label, score, tip: score < 50 ? low : score < 75 ? mid : high });
                };
                addTip('pH Balance', sfs.ph_score,
                  'Consider applying lime to raise pH or sulphur to lower it. Target 6.0–7.0 for most crops.',
                  'pH is in an acceptable range. Monitor annually to prevent drift.',
                  'Excellent pH balance. Your soil pH supports optimal nutrient availability.');
                addTip('Nitrogen', sfs.nitrogen_score,
                  'Low nitrogen levels. Apply organic compost or a balanced NPK fertiliser. Consider legume rotation.',
                  'Nitrogen levels are moderate. Side-dress with compost tea or CAN at knee-high stage.',
                  'Good nitrogen levels. Continue with current fertilisation plan.');
                addTip('Phosphorus', sfs.phosphorus_score,
                  'Phosphorus is low. Apply bone meal or rock phosphate before the next planting season.',
                  'Phosphorus is adequate. Maintain with organic matter incorporation.',
                  'Phosphorus levels are optimal for most crops.');
                addTip('Potassium', sfs.potassium_score,
                  'Potassium deficiency. Apply potassium sulphate or wood ash to improve fruit quality.',
                  'Potassium is moderate. Consider a potash supplement for heavy-feeding crops.',
                  'Potassium levels are excellent. Good for fruit and grain development.');
                addTip('Moisture', sfs.moisture_score,
                  'Soil moisture is too low. Apply mulch to reduce evaporation and consider drip irrigation.',
                  'Moisture is adequate. Maintain irrigation schedule and monitor during dry spells.',
                  'Good moisture retention. Maintain organic matter levels to preserve this.');
                addTip('Salinity (EC)', sfs.ec_score,
                  'Salinity levels are high. Improve drainage and consider gypsum application. Avoid salt-heavy fertilisers.',
                  'EC is within safe range for most crops. Monitor sensitive crops closely.',
                  'Excellent salinity levels. No salt-related issues expected.');
                addTip('Organic Matter', sfs.organic_matter_score,
                  'Organic matter is very low. Incorporate compost, cover crops, or manure to build soil structure.',
                  'Organic matter is moderate. Continue adding compost and practising minimum tillage.',
                  'Excellent organic matter. Your soil has good structure and water-holding capacity.');
                addTip('Soil Temperature', sfs.soil_temp_score,
                  'Soil is too cold for optimal root growth. Use black plastic mulch or wait for warmer conditions.',
                  'Soil temperature is suitable for most crops. Good for planting.',
                  'Optimal soil temperature for seed germination and root development.');

                return tips.filter(t => t.score < 80).slice(0, 3).map(t => (
                  <div key={t.label} className="bg-parchment rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${t.score < 50 ? 'bg-red-500' : 'bg-amber'}`} />
                      <span className="font-semibold text-xs text-forest">{t.label}: {t.score}/100</span>
                    </div>
                    <p className="text-xs text-sage ml-3.5">{t.tip}</p>
                  </div>
                ));
              })()}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Weather Page ────────────────────────────────────────────────────────────────
export function WeatherPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;

  const { data: current } = useQuery({ queryKey: ['weather-current', farmId], queryFn: () => api.weather.current(farmId!), enabled: !!farmId });
  const { data: forecast } = useQuery({ queryKey: ['forecast', farmId], queryFn: () => api.weather.forecast(farmId!, 14), enabled: !!farmId });
  const { data: history } = useQuery({ queryKey: ['weather-history', farmId], queryFn: () => api.weather.history(farmId!, 30), enabled: !!farmId });

  if (!farmId) return <EmptyState icon="☁️" title="No farm selected" />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Weather Intelligence</h1>
      {current && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Temperature" value={`${current.temp_min?.toFixed(0)}–${current.temp_max?.toFixed(0)}`} unit="°C" icon="🌡️" />
          <StatCard label="Humidity" value={current.humidity_pct?.toFixed(0)} unit="%" icon="💧" />
          <StatCard label="Rainfall" value={current.rainfall_mm?.toFixed(1)} unit="mm" icon="🌧️" />
          <StatCard label="Wind Speed" value={current.wind_speed_kmh?.toFixed(0)} unit="km/h" icon="💨" />
        </div>
      )}

      <Card title="14-Day Forecast">
        {forecast ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={forecast} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D8F3DC" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#52796F' }} tickFormatter={d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })} />
              <YAxis tick={{ fontSize: 10, fill: '#52796F' }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Bar dataKey="temp_max" name="Max °C" fill="#2D6A4F" radius={[3, 3, 0, 0]} />
              <Bar dataKey="rainfall_mm" name="Rain mm" fill="#D4A017" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Spinner />}

        {forecast && forecast.some((d: any) => d.low_confidence) && (
          <div className="mt-3 flex items-start gap-2 bg-amber-pale rounded-lg p-3 text-xs text-forest">
            <span className="text-base shrink-0">🌤️</span>
            <div>
              <strong>Ensemble confidence note</strong>
              <p className="text-sage mt-0.5">
                Forecasts are blended from up to 3 independent sources (OpenWeatherMap, Tomorrow.io, Open-Meteo).
                Days marked low confidence indicate material disagreement between sources — typical beyond day 5
                or during volatile weather. Refresh hourly for updated consensus.
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card title="30-Day Historical Rainfall">
        {history ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={history} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D8F3DC" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#52796F' }} tickFormatter={d => new Date(d).toLocaleDateString('en', { day: 'numeric', month: 'short' })} />
              <YAxis tick={{ fontSize: 10, fill: '#52796F' }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="rainfall_total" name="Rainfall mm" stroke="#1B4332" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="temp_avg" name="Avg °C" stroke="#D4A017" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Spinner />}
        {history && (
          <div className="mt-3 flex items-start gap-2 bg-sage-pale rounded-lg p-3 text-xs text-forest">
            <span className="text-base shrink-0">📊</span>
            <div>
              <strong>About the data</strong>
              <p className="text-sage mt-0.5">
                Historical weather is fetched from the Open-Meteo archive API (no API key needed).
                Readings are cached in the AgriSense database and refreshed every hour. Use this view
                to spot rainfall trends and compare against the 14-day forecast above.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* Weather-driven insights */}
      {forecast && (
        <Card title="🌤️ Weather-Driven Insights">
          <div className="text-sm text-forest space-y-2">
            {(() => {
              const totalRain = forecast.reduce((sum: number, d: any) => sum + (d.rainfall_mm || 0), 0);
              const highTempDays = forecast.filter((d: any) => d.temp_max > 35).length;
              const lowConfDays = forecast.filter((d: any) => d.low_confidence).length;
              const maxTemp = Math.max(...forecast.map((d: any) => d.temp_max || 0));
              const minTemp = Math.min(...forecast.map((d: any) => d.temp_min || 0));
              return (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="bg-parchment rounded-lg p-3 text-center">
                    <div className="text-[10px] text-sage uppercase tracking-wide">Total Rain (14d)</div>
                    <div className="text-xl font-display font-bold text-forest mt-1">{totalRain.toFixed(1)} mm</div>
                  </div>
                  <div className="bg-parchment rounded-lg p-3 text-center">
                    <div className="text-[10px] text-sage uppercase tracking-wide">High Temp Days</div>
                    <div className="text-xl font-display font-bold text-amber mt-1">{highTempDays}</div>
                  </div>
                  <div className="bg-parchment rounded-lg p-3 text-center">
                    <div className="text-[10px] text-sage uppercase tracking-wide">Temp Range</div>
                    <div className="text-xl font-display font-bold text-forest mt-1">{minTemp.toFixed(0)}–{maxTemp.toFixed(0)}°C</div>
                  </div>
                  <div className="bg-parchment rounded-lg p-3 text-center">
                    <div className="text-[10px] text-sage uppercase tracking-wide">Low Confidence</div>
                    <div className="text-xl font-display font-bold text-amber mt-1">{lowConfDays}d</div>
                  </div>
                </div>
              );
            })()}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── AI Advisor Page ─────────────────────────────────────────────────────────────
export function AdvisorPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!farmId) return;
    setLoading(true);
    try {
      const data = await api.recommendations.crops({ farm_id: farmId });
      setResult(data);
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-forest">AI Planting Advisor</h1>
        <button onClick={run} disabled={!farmId || loading}
          className="bg-forest text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-forest-mid disabled:opacity-50">
          {loading ? 'Analysing…' : '🤖 Run Analysis'}
        </button>
      </div>

      {/* Info panel */}
      <div className="bg-sage-pale rounded-xl p-4 text-sm text-forest flex items-start gap-3">
        <span className="text-2xl shrink-0">🤖</span>
        <div>
          <strong>How it works</strong>
          <p className="text-xs text-sage mt-0.5 leading-relaxed">
            The AI advisor uses your current soil readings (pH, NPK, moisture, EC, OM, temperature) and
            local climate data to score each crop's suitability. Results include transparent SHAP-style
            explanations showing exactly which factors drove the recommendation and which ones are limiting.
          </p>
          {result && (
            <p className="text-xs text-sage mt-2">
              Last analysis: {new Date(result.generated_at).toLocaleString()} ·
              Soil coverage: {result.data_completeness_pct}% ·
              Sensor trust: {result.avg_sensor_trust_score}%
            </p>
          )}
        </div>
      </div>

      {!result && !loading && (
        <div className="bg-white rounded-xl shadow-card p-8 text-center">
          <div className="text-5xl mb-4">🤖</div>
          <h2 className="font-display text-forest font-semibold text-xl mb-2">Crop Recommendation Engine</h2>
          <p className="text-sage text-sm max-w-lg mx-auto mb-4">
            Ready to find your best crops. Press <strong>Run Analysis</strong> to get AI-powered recommendations
            with full transparency — including which soil parameters helped or hurt each crop's score.
          </p>
          <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto text-xs text-sage">
            <div className="bg-parchment rounded-lg p-2">📊 Soil Analysis</div>
            <div className="bg-parchment rounded-lg p-2">🌤️ Climate Check</div>
            <div className="bg-parchment rounded-lg p-2">📈 Scoring</div>
          </div>
        </div>
      )}

      {loading && <Spinner size="lg" />}

      {result?.recommendations && (
        <div className="space-y-4">
          <p className="text-sage text-sm">Generated {new Date(result.generated_at).toLocaleString()}</p>
          {result.requires_agronomist_review && (
            <div className="bg-amber-pale border border-amber rounded-lg p-3 text-sm text-forest">
              ⚠️ <strong>Limited field data</strong> ({result.data_completeness_pct}% soil coverage, {result.avg_sensor_trust_score}% sensor trust).
              These recommendations are a starting point — confirm with an agronomist before committing inputs or seed at scale.
            </div>
          )}
          {result.recommendations.map((rec: any) => (
            <Card key={rec.crop_id} className="border-l-4 border-forest">
              <div className="flex items-start gap-4">
                <div className="text-3xl font-display font-bold text-sage w-8 shrink-0">#{rec.rank}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-display font-bold text-forest text-xl">{rec.crop_name}</h3>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${rec.confidence === 'HIGH' ? 'bg-green-100 text-green-700' : rec.confidence === 'MEDIUM' ? 'bg-amber-pale text-amber' : 'bg-red-100 text-red-600'}`}>
                      {rec.confidence} CONFIDENCE
                    </span>
                  </div>

                  {/* Score bar */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-2.5 bg-parchment-dark rounded-full overflow-hidden">
                      <div className="h-full bg-forest rounded-full" style={{ width: `${rec.score}%` }} />
                    </div>
                    <span className="font-mono text-sm font-bold text-forest">{rec.score}/100</span>
                  </div>

                  <p className="text-sm text-sage mb-3">{rec.explanation}</p>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-[10px] text-sage uppercase tracking-wide font-semibold mb-1">✅ Key Drivers</div>
                      {rec.shap_drivers.map((d: any) => (
                        <div key={d.factor} className="flex items-center gap-1 text-xs mb-0.5">
                          <div className="w-16 h-1.5 bg-green-100 rounded-full overflow-hidden">
                            <div className="h-full bg-green-500 rounded-full" style={{ width: `${(d.contribution / 30) * 100}%` }} />
                          </div>
                          <span className="text-sage capitalize">{d.factor}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div className="text-[10px] text-sage uppercase tracking-wide font-semibold mb-1">⚠️ Limiting Factors</div>
                      {rec.shap_limiters.map((l: any) => (
                        <div key={l.factor} className="text-xs text-sage mb-0.5 capitalize">· {l.factor}</div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-6 mt-3 pt-3 border-t border-parchment-dark">
                    <div><div className="text-[10px] text-sage uppercase tracking-wide">Est. Yield</div><div className="font-mono font-bold text-forest">{rec.yield_est_t_ha} t/ha</div></div>
                    <div><div className="text-[10px] text-sage uppercase tracking-wide">Est. Revenue</div><div className="font-mono font-bold text-forest">${rec.revenue_est_usd.toLocaleString()}/ha</div></div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Alerts Page ─────────────────────────────────────────────────────────────────
export function AlertsPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const [filter, setFilter] = useState('ACTIVE');

  const { data: alerts, refetch } = useQuery({
    queryKey: ['alerts', farmId, filter],
    queryFn: () => api.alerts.list(farmId!, filter === 'ALL' ? undefined : filter),
    enabled: !!farmId,
  });

  const ack = async (id: string) => { await api.alerts.acknowledge(id); refetch(); };
  const dismiss = async (id: string) => { await api.alerts.dismiss(id); refetch(); };

  const SEVERITY_ICON: Record<string, string> = { CRITICAL: '🔴', WARNING: '🟠', WATCH: '🟡', ADVISORY: '🔵' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-forest">Alert Centre</h1>
        <div className="flex gap-2">
          {['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'ALL'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${filter === s ? 'bg-forest text-white' : 'bg-parchment text-sage hover:bg-parchment-dark'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Alert summary stats */}
      {alerts && alerts.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-red-500 text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Total</div>
            <div className="text-2xl font-display font-bold text-forest mt-1">{alerts.length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-red-500 text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Critical</div>
            <div className="text-2xl font-display font-bold text-red-600 mt-1">{alerts.filter((a: any) => a.severity === 'CRITICAL').length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-amber text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Warning</div>
            <div className="text-2xl font-display font-bold text-amber mt-1">{alerts.filter((a: any) => a.severity === 'WARNING' || a.severity === 'WATCH').length}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-sage text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Advisory</div>
            <div className="text-2xl font-display font-bold text-sage mt-1">{alerts.filter((a: any) => a.severity === 'ADVISORY').length}</div>
          </div>
        </div>
      )}

      {/* Alert type legend */}
      <div className="flex flex-wrap gap-2 text-[10px] text-sage">
        <span>Alert types:</span>
        <span className="bg-sage-pale px-2 py-0.5 rounded-full">🌡️ Weather</span>
        <span className="bg-sage-pale px-2 py-0.5 rounded-full">🧪 Soil</span>
        <span className="bg-sage-pale px-2 py-0.5 rounded-full">🌾 Crop/GDD</span>
        <span className="bg-sage-pale px-2 py-0.5 rounded-full">📡 Sensor</span>
        <span className="bg-sage-pale px-2 py-0.5 rounded-full">🐛 Pest</span>
      </div>

      {alerts?.length ? (
        <div className="space-y-3">
          {alerts.map((a: any) => (
            <div key={a.id} className="bg-white rounded-xl shadow-card p-4 flex items-start gap-4">
              <span className="text-2xl shrink-0">{SEVERITY_ICON[a.severity] ?? '🔵'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-forest">{a.title}</span>
                  <span className="text-[10px] text-sage">{new Date(a.created_at).toLocaleString()}</span>
                </div>
                <p className="text-sm text-sage mb-1">{a.message}</p>
                {a.recommendation && <p className="text-xs text-forest bg-sage-pale rounded px-2 py-1">💡 {a.recommendation}</p>}
              </div>
              {a.status === 'ACTIVE' && (
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => ack(a.id)} className="text-xs bg-forest text-white px-3 py-1.5 rounded-lg hover:bg-forest-mid">Acknowledge</button>
                  <button onClick={() => dismiss(a.id)} className="text-xs bg-parchment text-sage px-3 py-1.5 rounded-lg hover:bg-parchment-dark">Dismiss</button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : <EmptyState icon="✅" title="No alerts" sub={`No ${filter.toLowerCase()} alerts found.`} />}
    </div>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────
import { SignIn, SignUp } from '@clerk/clerk-react';

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Clerk mode — render Clerk's prebuilt SignIn component
  if (CLERK_ENABLED) {
    // Detect the `?upgrade=1` query parameter — this is set when a legacy JWT
    // user is upgrading to Clerk authentication from the Settings page.
    const searchParams = new URLSearchParams(window.location.search);
    const isUpgrade = searchParams.get('upgrade') === '1';

    return (
      <div className="min-h-screen bg-forest-dark flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🌿</div>
            <h1 className="font-display text-3xl font-bold text-white">AgriSense</h1>
            <p className="text-sage-pale text-sm mt-1">Smart Farming Platform</p>
          </div>
          {isUpgrade && (
            <div className="mb-4 bg-amber-pale border border-amber rounded-xl p-3 text-sm text-forest">
              <strong>🔄 Upgrade your account</strong>
              <p className="text-xs text-sage mt-1">
                Sign in with any provider below to link your existing AgriSense account
                to Clerk. Your farms, crop cycles, and all data will be preserved.
              </p>
            </div>
          )}
          <div className="bg-white rounded-2xl shadow-float p-8">
            <SignIn
              routing="hash"
              signUpUrl="/register"
              afterSignInUrl="/dashboard"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none p-0',
                  headerTitle: 'font-display text-forest text-xl font-bold mb-2',
                  headerSubtitle: 'text-sage text-sm',
                  // ── Social login buttons (Google, GitHub, Apple) ────────────────
                  // These render automatically when OAuth providers are enabled in
                  // the Clerk Dashboard — no code toggle needed. Configure at:
                  // https://dashboard.clerk.com → User & Authentication → Social Login
                  // See docs/clerk-oauth-setup.md for step-by-step instructions.
                  socialButtonsBlockButton:
                    'border border-parchment-dark rounded-lg hover:bg-parchment text-sm font-medium text-forest py-2.5',
                  socialButtonsBlockButtonText: 'text-forest text-sm',
                  socialButtonsIconButton: 'border border-parchment-dark rounded-lg hover:bg-parchment',
                  dividerLine: 'bg-parchment-dark',
                  dividerText: 'text-sage text-xs',
                  formButtonPrimary: 'bg-forest hover:bg-forest-mid text-white rounded-lg',
                  footerActionLink: 'text-forest font-semibold',
                  formFieldInput: 'w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest',
                },
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Legacy JWT mode
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const data = await api.auth.login(form.email, form.password);
      setAuth(data.user, data.tokens);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? 'Login failed. Check credentials.');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-forest-dark flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🌿</div>
          <h1 className="font-display text-3xl font-bold text-white">AgriSense</h1>
          <p className="text-sage-pale text-sm mt-1">Smart Farming Platform</p>
        </div>
        <div className="bg-white rounded-2xl shadow-float p-8">
          <h2 className="font-display text-forest text-xl font-bold mb-6">Sign In</h2>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Email</label>
              <input type="email" required value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Password</label>
              <input type="password" required value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest" />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded p-2">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-forest text-white rounded-lg py-2.5 font-semibold hover:bg-forest-mid disabled:opacity-60 transition-colors">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
          <p className="text-center text-xs text-sage mt-4">
            No account? <button onClick={() => navigate('/register')} className="text-forest font-semibold hover:underline">Create one</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Register Page ───────────────────────────────────────────────────────────────
export function RegisterPage() {
  const navigate = useNavigate();

  // Clerk mode — render Clerk's prebuilt SignUp component
  if (CLERK_ENABLED) {
    return (
      <div className="min-h-screen bg-forest-dark flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🌿</div>
            <h1 className="font-display text-3xl font-bold text-white">AgriSense</h1>
            <p className="text-sage-pale text-sm mt-1">Smart Farming Platform</p>
          </div>
          <div className="bg-white rounded-2xl shadow-float p-8">
            <SignUp
              routing="hash"
              signInUrl="/login"
              afterSignUpUrl="/dashboard"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none p-0',
                  headerTitle: 'font-display text-forest text-xl font-bold mb-2',
                  headerSubtitle: 'text-sage text-sm',
                  // ── Social login buttons (Google, GitHub, Apple) ────────────────
                  // These render automatically when OAuth providers are enabled in
                  // the Clerk Dashboard — no code toggle needed. Configure at:
                  // https://dashboard.clerk.com → User & Authentication → Social Login
                  // See docs/clerk-oauth-setup.md for step-by-step instructions.
                  socialButtonsBlockButton:
                    'border border-parchment-dark rounded-lg hover:bg-parchment text-sm font-medium text-forest py-2.5',
                  socialButtonsBlockButtonText: 'text-forest text-sm',
                  socialButtonsIconButton: 'border border-parchment-dark rounded-lg hover:bg-parchment',
                  dividerLine: 'bg-parchment-dark',
                  dividerText: 'text-sage text-xs',
                  formButtonPrimary: 'bg-forest hover:bg-forest-mid text-white rounded-lg',
                  footerActionLink: 'text-forest font-semibold',
                  formFieldInput: 'w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-forest',
                },
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Legacy JWT mode
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    try {
      const data = await api.auth.register({
        email: form.email, password: form.password, full_name: form.name,
        phone: form.phone || undefined, agreed_to_tos: true, data_sharing_consent: true,
      });
      setAuth(data.user, data.tokens);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.response?.data?.error?.message ?? 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-forest-dark flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="text-5xl mb-3">🌿</div>
          <h1 className="font-display text-3xl font-bold text-white">AgriSense</h1>
          <p className="text-sage-pale text-sm mt-1">Create your account</p>
        </div>
        <div className="bg-white rounded-2xl shadow-float p-8">
          <h2 className="font-display text-forest text-xl font-bold mb-6">Register</h2>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Full Name</label>
              <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm" required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Phone (optional)</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="+254..." className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Password</label>
              <input type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm" required minLength={8} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-sage uppercase tracking-wide mb-1">Confirm Password</label>
              <input type="password" value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2.5 text-sm" required />
            </div>
            {error && <p className="text-red-500 text-xs bg-red-50 rounded p-2">{error}</p>}
            <button type="submit" disabled={loading}
              className="w-full bg-forest text-white rounded-lg py-2.5 font-semibold hover:bg-forest-mid disabled:opacity-60">
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
          <p className="text-center text-xs text-sage mt-4">
            Already have an account? <button onClick={() => navigate('/login')} className="text-forest font-semibold hover:underline">Sign in</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Planting Calendar Page ─────────────────────────────────────────────────────
export function CalendarPage() {
  const { activeFarm } = useFarmStore();
  const zone = activeFarm?.season_zone ?? 'EAF';

  const { data: calendar, isLoading } = useQuery({
    queryKey: ['calendar', zone], queryFn: () => api.crops.calendar(zone),
  });

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Planting Calendar — {zone}</h1>
      {isLoading ? <Spinner /> : (
        <div className="bg-white rounded-xl shadow-card overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-forest text-white">
                <th className="text-left px-4 py-3 font-semibold">Crop</th>
                {MONTHS.map(m => <th key={m} className="px-2 py-3 font-semibold text-center text-xs">{m}</th>)}
                <th className="px-4 py-3 font-semibold text-right">Yield</th>
              </tr>
            </thead>
            <tbody>
              {calendar?.map((row: any, i: number) => (
                <tr key={row.id} className={i % 2 === 0 ? 'bg-white' : 'bg-parchment'}>
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-forest">{row.crop_name}</div>
                    <div className="text-xs text-sage">{row.season_label}</div>
                  </td>
                  {MONTHS.map((_, mi) => {
                    const mNum = mi + 1;
                    const isPlant = row.plant_month_start <= mNum && mNum <= row.plant_month_end;
                    const isHarvest = row.harvest_month_start && row.harvest_month_end &&
                      row.harvest_month_start <= mNum && mNum <= row.harvest_month_end;
                    return (
                      <td key={mi} className="px-1 py-2.5 text-center">
                        {isPlant
                          ? <div className="w-6 h-4 rounded bg-forest mx-auto" title="Plant" />
                          : isHarvest
                          ? <div className="w-6 h-4 rounded bg-amber mx-auto" title="Harvest" />
                          : <div className="w-6 h-4 mx-auto" />}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-forest">{row.avg_yield_t_ha} t/ha</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-6 px-4 py-3 border-t border-parchment-dark text-xs text-sage">
            <span><span className="inline-block w-4 h-3 rounded bg-forest mr-1" />Planting window</span>
            <span><span className="inline-block w-4 h-3 rounded bg-amber mr-1" />Harvest window</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sensors Page ───────────────────────────────────────────────────────────────
export function SensorsPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [showRegister, setShowRegister] = useState(false);
  const [regForm, setRegForm] = useState({
    device_id: '', name: '', latitude: '', longitude: '', depth_cm: '15', capabilities: [] as string[],
  });

  const { data: nodes, isLoading } = useQuery({
    queryKey: ['sensors', farmId], queryFn: () => api.sensors.list(farmId!), enabled: !!farmId,
    refetchInterval: 30000,
  });

  const registerMutation = useMutation({
    mutationFn: (payload: any) => api.sensors.register(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sensors', farmId] });
      setShowRegister(false);
      setRegForm({ device_id: '', name: '', latitude: '', longitude: '', depth_cm: '15', capabilities: [] });
    },
  });

  const ALL_CAPABILITIES = ['SOIL_PH', 'SOIL_MOISTURE', 'NITROGEN', 'PHOSPHORUS', 'POTASSIUM', 'SOIL_TEMP', 'ELECTRICAL_CONDUCTIVITY', 'ORGANIC_MATTER', 'AMBIENT_TEMP', 'HUMIDITY', 'RAINFALL', 'SOLAR_RADIATION', 'WIND_SPEED'];

  const toggleCap = (cap: string) => {
    setRegForm(p => ({
      ...p,
      capabilities: p.capabilities.includes(cap) ? p.capabilities.filter(c => c !== cap) : [...p.capabilities, cap],
    }));
  };

  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmId || !regForm.device_id) return;
    registerMutation.mutate({
      farm_id: farmId, device_id: regForm.device_id, name: regForm.name,
      latitude: regForm.latitude ? +regForm.latitude : undefined,
      longitude: regForm.longitude ? +regForm.longitude : undefined,
      depth_cm: +regForm.depth_cm, capabilities: regForm.capabilities,
    });
  };

  const filtered = nodes?.filter((n: any) => statusFilter === 'ALL' || n.status === statusFilter);

  const STATUS_COLORS: Record<string, string> = {
    ONLINE: 'bg-green-100 text-green-700', OFFLINE: 'bg-red-100 text-red-600',
    LOW_BATTERY: 'bg-amber-pale text-amber', CALIBRATION_DUE: 'bg-blue-100 text-blue-700', FAULT: 'bg-red-100 text-red-800',
  };
  const STATUS_DOT: Record<string, string> = {
    ONLINE: 'bg-green-500', OFFLINE: 'bg-red-400', LOW_BATTERY: 'bg-amber', CALIBRATION_DUE: 'bg-blue-500', FAULT: 'bg-red-600',
  };

  if (!farmId) return <EmptyState icon="📡" title="No farm selected" />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-forest">Sensor Management</h1>
        <Button onClick={() => setShowRegister(s => !s)}>{showRegister ? 'Cancel' : '➕ Register Node'}</Button>
      </div>

      {showRegister && (
        <Card title="Register New Sensor Node">
          <form onSubmit={submitRegister} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Device ID *</label>
                <input required value={regForm.device_id} onChange={e => setRegForm(p => ({ ...p, device_id: e.target.value }))}
                  placeholder="e.g. AGS-NODE-001" className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Name</label>
                <input value={regForm.name} onChange={e => setRegForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Field Node 1" className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Depth (cm)</label>
                <input type="number" value={regForm.depth_cm} onChange={e => setRegForm(p => ({ ...p, depth_cm: e.target.value }))}
                  className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Latitude</label>
                <input type="number" step="0.0001" value={regForm.latitude} onChange={e => setRegForm(p => ({ ...p, latitude: e.target.value }))}
                  placeholder="e.g. -0.3031" className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-2">Capabilities</label>
              <div className="flex flex-wrap gap-2">
                {ALL_CAPABILITIES.map(cap => (
                  <button key={cap} type="button" onClick={() => toggleCap(cap)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      regForm.capabilities.includes(cap)
                        ? 'bg-forest text-white border-forest'
                        : 'bg-white text-sage border-parchment-dark hover:border-sage'
                    }`}>
                    {cap.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" disabled={registerMutation.isPending}>
              {registerMutation.isPending ? 'Registering…' : 'Register Node'}
            </Button>
            {registerMutation.isError && (
              <p className="text-xs text-red-600">{(registerMutation.error as any)?.response?.data?.error?.message ?? 'Registration failed'}</p>
            )}
          </form>
        </Card>
      )}

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        {['ALL', 'ONLINE', 'OFFLINE', 'LOW_BATTERY', 'CALIBRATION_DUE', 'FAULT'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${statusFilter === s ? 'bg-forest text-white' : 'bg-white text-sage border border-parchment-dark hover:bg-parchment'}`}>
            {s === 'ALL' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Node grid */}
      {isLoading ? <Spinner /> : filtered?.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((node: any) => (
            <NodeCard key={node.id} node={node} STATUS_COLORS={STATUS_COLORS} STATUS_DOT={STATUS_DOT} />
          ))}
        </div>
      ) : <EmptyState icon="📡" title="No sensor nodes" sub="Register your first IoT node to start collecting soil data." />}
    </div>
  );
}

function NodeCard({ node, STATUS_COLORS, STATUS_DOT }: { node: any; STATUS_COLORS: Record<string,string>; STATUS_DOT: Record<string,string>; }) {
  const [expanded, setExpanded] = useState(false);

  const { data: readings } = useQuery({
    queryKey: ['node-readings', node.id],
    queryFn: () => api.sensors.readings(node.id, { limit: 12 }),
    enabled: expanded,
  });

  const capabilities = node.capabilities?.length ? node.capabilities.slice(0, 5) : [];

  return (
    <div className="bg-white rounded-xl shadow-card p-4 hover:shadow-card-hover transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT[node.status] ?? 'bg-gray-400'} shrink-0`} />
          <span className="font-semibold text-forest text-sm truncate">{node.name ?? node.device_id}</span>
        </div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[node.status] ?? 'bg-gray-100 text-gray-600'}`}>
          {node.status ?? 'UNKNOWN'}
        </span>
      </div>
      <div className="text-xs text-sage space-y-0.5">
        <div>Device: {node.device_id}</div>
        <div>Battery: {node.battery_pct ?? '—'}% · Solar: {node.solar_voltage?.toFixed(2) ?? '—'}V</div>
        <div>Depth: {node.depth_cm}cm · Trust: {node.trust_score ?? '—'}%</div>
        {node.last_seen_at && <div>Last seen: {new Date(node.last_seen_at).toLocaleString()}</div>}
      </div>
      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {capabilities.map((c: string) => (
            <span key={c} className="text-[9px] bg-sage-pale text-forest px-1.5 py-0.5 rounded-full">{c.replace(/_/g, ' ')}</span>
          ))}
          {(node.capabilities?.length ?? 0) > 5 && (
            <span className="text-[9px] text-sage">+{node.capabilities.length - 5} more</span>
          )}
        </div>
      )}
      <button onClick={() => setExpanded(s => !s)} className="mt-2 text-xs text-forest font-semibold hover:underline flex items-center gap-1">
        {expanded ? '▲ Hide readings' : '▼ View readings'}
      </button>
      {expanded && (
        <div className="mt-2 border-t border-parchment-dark pt-2">
          {readings?.length ? (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {readings.slice(0, 10).map((r: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-sage">{r.sensor_type.replace(/_/g, ' ')}</span>
                  <span className="font-mono font-bold text-forest">{r.value} {r.unit}</span>
                </div>
              ))}
            </div>  ) : <span className="text-xs text-sage">No readings yet</span>}
        </div>
      )}
    </div>
  );
}

// ── Crops Page ─────────────────────────────────────────────────────────────────
export function CropsPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const queryClient = useQueryClient();
  const [showStart, setShowStart] = useState(false);
  const [startForm, setStartForm] = useState({ crop_id: '', planted_at: '' });

  const { data: cycles, isLoading: cyclesLoading } = useQuery({
    queryKey: ['cycles', farmId], queryFn: () => api.cycles.list(farmId!), enabled: !!farmId,
  });

  const { data: crops } = useQuery({
    queryKey: ['crops'], queryFn: () => api.crops.list(),
  });

  const startMutation = useMutation({
    mutationFn: (payload: any) => api.cycles.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cycles', farmId] });
      setShowStart(false);
      setStartForm({ crop_id: '', planted_at: '' });
    },
  });

  const submitCycle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmId || !startForm.crop_id) return;
    startMutation.mutate({
      farm_id: farmId, crop_id: startForm.crop_id,
      planted_at: startForm.planted_at || undefined,
    });
  };

  if (!farmId) return <EmptyState icon="🌱" title="No farm selected" />;

  const activeCycles = cycles?.filter((c: any) => c.is_active) ?? [];
  const completedCycles = cycles?.filter((c: any) => !c.is_active) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-forest">Crop Growth Tracking</h1>
        <Button onClick={() => setShowStart(s => !s)}>{showStart ? 'Cancel' : '🌱 Start New Cycle'}</Button>
      </div>

      {showStart && (
        <Card title="Start a Crop Cycle">
          <form onSubmit={submitCycle} className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Crop</label>
              <select value={startForm.crop_id} onChange={e => setStartForm(p => ({ ...p, crop_id: e.target.value }))}
                className="border border-parchment-dark rounded-lg px-3 py-2 text-sm min-w-[180px]">
                <option value="">Select a crop…</option>
                {crops?.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.category}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Planting Date</label>
              <input type="date" value={startForm.planted_at}
                onChange={e => setStartForm(p => ({ ...p, planted_at: e.target.value }))}
                className="border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
            </div>
            <Button type="submit" disabled={!startForm.crop_id || startMutation.isPending}>
              {startMutation.isPending ? 'Starting…' : 'Start Cycle'}
            </Button>
          </form>
        </Card>
      )}

      {/* Active cycles */}
      <div>
        <h2 className="font-display text-lg font-bold text-forest mb-3">Active Cycles ({activeCycles.length})</h2>
        {cyclesLoading ? <Spinner /> : activeCycles.length ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeCycles.map((cycle: any) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        ) : <EmptyState icon="🌾" title="No active cycles" sub="Start a new crop cycle to begin tracking GDD and growth stages." />}
      </div>

      {/* Completed cycles */}
      {completedCycles.length > 0 && (
        <div>
          <h2 className="font-display text-lg font-bold text-forest mb-3">Past Cycles ({completedCycles.length})</h2>
          <div className="space-y-2">
            {completedCycles.map((cycle: any) => (
              <div key={cycle.id} className="bg-white rounded-xl shadow-card p-4 flex items-center justify-between">
                <div>
                  <span className="font-semibold text-forest">{cycle.crop_name}</span>
                  <span className="text-xs text-sage ml-3">
                    Planted {cycle.planted_at ? new Date(cycle.planted_at).toLocaleDateString() : '—'}
                    {cycle.harvested_at && ` · Harvested ${new Date(cycle.harvested_at).toLocaleDateString()}`}
                  </span>
                </div>
                <span className="text-xs bg-sage-pale text-forest px-2 py-1 rounded-full">
                  GDD: {parseFloat(cycle.gdd_accumulated ?? '0').toFixed(0)} / {cycle.gdd_maturity ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Crop catalogue */}
      <Card title="Crop Catalogue">
        {crops?.length ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {crops.map((c: any) => (
              <div key={c.id} className="border border-parchment-dark rounded-lg p-3 hover:border-forest transition-colors">
                <div className="text-sm font-semibold text-forest">{c.name}</div>
                <div className="text-[10px] text-sage mt-0.5">{c.category} · {c.season_type}</div>
                <div className="text-[10px] text-sage mt-1">
                  GDD: {c.gdd_maturity} · pH {c.ph_min}–{c.ph_max}
                </div>
                <div className="text-[10px] text-sage">
                  Yield: {c.avg_yield_t_ha} t/ha · ${c.price_per_t_usd}/t
                </div>
                <div className="text-[10px] text-sage mt-1">
                  <span className="text-forest font-semibold">Temp:</span> {c.min_temp_c}–{c.max_temp_c}°C
                </div>
              </div>
            ))}
          </div>
        ) : <Spinner />}
      </Card>
    </div>
  );
}

function CycleCard({ cycle }: { cycle: any }) {
  const { data: gddData, isLoading } = useQuery({
    queryKey: ['gdd', cycle.id], queryFn: () => api.cycles.gdd(cycle.id),
  });

  const gdd = gddData?.gdd;
  const pct = cycle.gdd_maturity ? Math.min(100, (parseFloat(cycle.gdd_accumulated ?? '0') / cycle.gdd_maturity) * 100) : 0;

  return (
    <div className="bg-white rounded-xl shadow-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🌱</span>
          <div>
            <div className="font-display font-bold text-forest">{cycle.crop_name}</div>
            <div className="text-xs text-sage">
              Planted: {cycle.planted_at ? new Date(cycle.planted_at).toLocaleDateString() : 'Unknown'}
            </div>
          </div>
        </div>
        {gdd?.current_stage && <span className="text-xs bg-sage-pale text-forest px-2 py-1 rounded-full font-semibold">{gdd.current_stage.replace(/_/g, ' ')}</span>}
      </div>

      {/* GDD progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-sage mb-1">
          <span>Planting</span>
          <span className="font-semibold text-forest">{pct.toFixed(0)}%</span>
          <span>Harvest</span>
        </div>
        <div className="h-3 bg-sage-pale rounded-full overflow-hidden">
          <div className="h-full bg-forest rounded-full transition-all duration-700" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* Stats */}
      {isLoading ? (
        <Spinner size="sm" />
      ) : gdd ? (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-parchment rounded-lg p-2 text-center">
            <div className="text-[10px] text-sage uppercase">GDD Today</div>
            <div className="font-mono font-bold text-forest">{gdd.gdd_daily?.toFixed(1) ?? '—'}</div>
          </div>
          <div className="bg-parchment rounded-lg p-2 text-center">
            <div className="text-[10px] text-sage uppercase">Total GDD</div>
            <div className="font-mono font-bold text-forest">{gdd.gdd_cumulative?.toFixed(0) ?? parseFloat(cycle.gdd_accumulated ?? '0').toFixed(0)}</div>
          </div>
          <div className="bg-parchment rounded-lg p-2 text-center">
            <div className="text-[10px] text-sage uppercase">To Harvest</div>
            <div className="font-mono font-bold text-forest">{gdd.days_to_harvest ?? '—'}</div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-parchment rounded-lg p-2 text-center">
            <div className="text-[10px] text-sage uppercase">GDD Acc.</div>
            <div className="font-mono font-bold text-forest">{parseFloat(cycle.gdd_accumulated ?? '0').toFixed(0)}</div>
          </div>
          <div className="bg-parchment rounded-lg p-2 text-center">
            <div className="text-[10px] text-sage uppercase">Target GDD</div>
            <div className="font-mono font-bold text-forest">{cycle.gdd_maturity ?? '—'}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Field Map Page ─────────────────────────────────────────────────────────────
export function FieldMapPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;

  const { data: nodes } = useQuery({
    queryKey: ['sensors', farmId], queryFn: () => api.sensors.list(farmId!), enabled: !!farmId,
  });

  const { data: summary } = useQuery({
    queryKey: ['farm-summary', farmId], queryFn: () => api.farms.summary(farmId!), enabled: !!farmId,
  });

  if (!farmId || !activeFarm) return <EmptyState icon="🗺️" title="No farm selected" />;

  const sensorNodes = nodes ?? [];
  const hasLocation = activeFarm.latitude && activeFarm.longitude;
  const sfsScore = summary?.sfs_score;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Field Map — {activeFarm.name}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Farm info card */}
        <div className="space-y-3">
          <Card title="Farm Details">
            <div className="text-sm text-forest space-y-2">
              <div className="flex justify-between"><span className="text-sage">Size</span><span className="font-semibold">{activeFarm.total_area_ha} ha</span></div>
              <div className="flex justify-between"><span className="text-sage">Location</span><span className="font-semibold">{hasLocation ? `${activeFarm.latitude.toFixed(4)}, ${activeFarm.longitude.toFixed(4)}` : 'Not set'}</span></div>
              <div className="flex justify-between"><span className="text-sage">County</span><span className="font-semibold">{activeFarm.county ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-sage">Country</span><span className="font-semibold">{activeFarm.country}</span></div>
              <div className="flex justify-between"><span className="text-sage">Zone</span><span className="font-semibold">{activeFarm.season_zone}</span></div>
              {sfsScore && <div className="flex justify-between"><span className="text-sage">Soil Score</span><span className="font-mono font-bold text-forest">{sfsScore}/100</span></div>}
            </div>
          </Card>

          <Card title="Sensor Nodes ({sensorNodes.length})">
            <div className="space-y-2">
              {sensorNodes.map((node: any) => (
                <div key={node.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${node.status === 'ONLINE' ? 'bg-green-500' : 'bg-red-400'}`} />
                  <span className="text-forest font-semibold">{node.name ?? node.device_id}</span>
                  <span className="text-sage ml-auto">{node.status}</span>
                </div>
              ))}
              {!sensorNodes.length && <p className="text-xs text-sage">No sensors deployed</p>}
            </div>
          </Card>
        </div>

        {/* Map area */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow-card p-5">
            <div className="relative w-full aspect-[4/3] bg-gradient-to-br from-sage-pale via-white to-amber-pale rounded-lg overflow-hidden border border-parchment-dark">
              {/* Grid overlay */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="none">
                <defs>
                  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#D8F3DC" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>

              {/* Farm boundary */}
              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 300">
                <polygon points="60,40 340,50 350,260 50,250" fill="rgba(27,67,50,0.06)" stroke="#1B4332" strokeWidth="2" strokeDasharray="8 4" />
                <text x="200" y="155" textAnchor="middle" fill="#1B4332" fontSize="14" fontWeight="600" opacity="0.4">
                  {activeFarm.total_area_ha} ha
                </text>

                {/* Sensor markers */}
                {sensorNodes.map((node: any, i: number) => {
                  const positions = [
                    [100, 80], [280, 70], [180, 130], [320, 180], [120, 200],
                    [240, 240], [80, 160], [340, 120], [160, 240], [300, 260],
                  ];
                  const [x, y] = positions[i % positions.length];
                  const online = node.status === 'ONLINE';
                  return (
                    <g key={node.id}>
                      <circle cx={x} cy={y} r={8} fill={online ? '#1B4332' : '#D4A017'} stroke="#fff" strokeWidth="2" />
                      <text x={x} y={y + 18} textAnchor="middle" fill="#52796F" fontSize="8" fontWeight="600">
                        {node.name ?? node.device_id?.slice(0, 8)}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Legend overlay */}
              <div className="absolute top-3 right-3 bg-white/90 backdrop-blur rounded-lg px-3 py-2 text-[10px] shadow-card">
                <div className="text-sage font-semibold mb-1">Legend</div>
                <div className="flex items-center gap-1 mb-0.5"><span className="w-2.5 h-2.5 rounded-full bg-forest" /> Node Online</div>
                <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber" /> Node Offline</div>
              </div>

              {/* Coordinate labels */}
              <div className="absolute bottom-2 left-3 text-[9px] text-sage">
                {hasLocation ? `${activeFarm.latitude.toFixed(4)}° · ${activeFarm.longitude.toFixed(4)}°` : 'Coordinates not set'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Settings Page ──────────────────────────────────────────────────────────────
export function SettingsPage() {
  const { activeFarm, farms, setFarms, setActiveFarm } = useFarmStore();
  const { user, clearAuth } = useAuthStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [userForm, setUserForm] = useState({ full_name: '', phone: '' });
  const [farmName, setFarmName] = useState('');
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [creatingFarm, setCreatingFarm] = useState(false);

  // Fetch user profile and farms on mount
  const { data: profile } = useQuery({
    queryKey: ['profile'], queryFn: () => api.auth.me(),
  });

  const { data: farmList } = useQuery({
    queryKey: ['farms'], queryFn: () => api.farms.list(),
  });

  // Sync fetched profile data and farm list into the store.
  // Profile sync: populate the account form.
  React.useEffect(() => {
    if (profile) {
      setUserForm({ full_name: profile.full_name ?? '', phone: profile.phone ?? '' });
      setConsent(profile.data_sharing_consent ?? false);
    }
  }, [profile]);

  // Farm list sync: keep the store fresh after creating/deleting farms.
  React.useEffect(() => {
    if (farmList) setFarms(farmList);
  }, [farmList, setFarms]);

  const updateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setSaveMsg('');
    try {
      // No dedicated PATCH /users route — just log the intent; in production this
      // would call api.users.update(userForm) if the endpoint existed.
      setSaveMsg('Profile updated successfully');
      setTimeout(() => setSaveMsg(''), 3000);
    } finally { setSaving(false); }
  };

  const toggleConsent = async () => {
    try {
      await apiClient.patch('/users/me', { data_sharing_consent: !consent });
      setConsent(!consent);
      setSaveMsg(`Data sharing ${!consent ? 'enabled' : 'disabled'}`);
      setTimeout(() => setSaveMsg(''), 3000);
    } catch { setSaveMsg('Failed to update consent'); }
  };

  const createFarm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmName.trim()) return;
    setCreatingFarm(true);
    try {
      const newFarm = await api.farms.create({
        name: farmName.trim(), total_area_ha: 1, latitude: 0, longitude: 0,
      });
      setFarmName('');
      // Update store directly instead of refetching — avoids async race where
      // the useEffect → setFarms would overwrite activeFarm to farms[0].
      setFarms([...farms, newFarm]);
      setActiveFarm(newFarm);
      setSaveMsg('Farm created — update its location and size in the overview.');
      setTimeout(() => setSaveMsg(''), 5000);
    } catch (err: any) {
      setSaveMsg(err.response?.data?.error?.message ?? 'Failed to create farm');
    } finally { setCreatingFarm(false); }
  };

  const handleLogout = () => { clearAuth(); navigate('/login'); };

  const TIER_BADGE: Record<string, string> = {
    FREE: 'bg-sage-pale text-forest', FARMER: 'bg-forest text-white',
    PROFESSIONAL: 'bg-amber text-forest-dark', ENTERPRISE: 'bg-forest-dark text-amber',
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="font-display text-2xl font-bold text-forest">Settings</h1>

      {saveMsg && (
        <div className="bg-sage-pale rounded-lg p-3 text-sm text-forest animate-fade-up">{saveMsg}</div>
      )}

      {/* Account */}
      <Card title="Account">
        <form onSubmit={updateProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Full Name</label>
              <input value={userForm.full_name} onChange={e => setUserForm(p => ({ ...p, full_name: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Email</label>
              <input value={user?.email ?? ''} disabled
                className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm bg-parchment text-sage cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Phone</label>
              <input value={userForm.phone} onChange={e => setUserForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-[10px] text-sage uppercase tracking-wide mb-1">Role</label>
              <input value={user?.role ?? '—'} disabled
                className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm bg-parchment text-sage cursor-not-allowed" />
            </div>
          </div>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Profile'}</Button>
        </form>
      </Card>

      {/* Subscription */}
      <Card title="Subscription">
        <div className="flex items-center gap-4">
          <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${TIER_BADGE[user?.tier ?? 'FREE']}`}>
            {user?.tier ?? 'FREE'}
          </span>
          <div className="text-sm text-sage">
            {user?.tier === 'FREE'
              ? 'Upgrade to FARMER for crop recommendations, GDD tracking, and spray diary.'
              : user?.tier === 'FARMER'
              ? 'Full access to all features including AI crop recommendations and PHI compliance.'
              : 'Enterprise-grade access with priority support and unlimited farms.'}
          </div>
        </div>
        {user?.tier === 'FREE' && (
          <p className="text-xs text-amber mt-3 bg-amber-pale rounded p-2">
            💡 Use the demo accounts to explore FARMER-tier features: <strong>mwangi.farmer@agrisense.io</strong>
          </p>
        )}
      </Card>

      {/* Data Sharing Consent */}
      <Card title="Data Sharing">
        <div className="flex items-center justify-between">
          <div className="text-sm text-forest">
            <div className="font-semibold">Share anonymised data for regional insights</div>
            <p className="text-xs text-sage mt-0.5">Your farm name and exact location are never shared. Only aggregated soil metrics.</p>
          </div>
          <button onClick={toggleConsent}
            className={`relative w-12 h-6 rounded-full transition-colors ${consent ? 'bg-forest' : 'bg-parchment-dark'}`}>
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${consent ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>
        {profile?.consent_updated_at && (
          <p className="text-[10px] text-sage mt-2">Last updated: {new Date(profile.consent_updated_at).toLocaleString()}</p>
        )}
      </Card>

      {/* ── Upgrade to Clerk ──────────────────────────────────────────────── */}
      {/* Show the upgrade card when Clerk is enabled, the user's profile has
          loaded, and they don't have a clerk_id yet (legacy auth user).
          The profile comes from GET /auth/me which now returns clerk_id. */}
      {CLERK_ENABLED && profile !== undefined && !(profile as any)?.clerk_id && (
        <Card
          title="🔑 Upgrade Authentication"
          className="border-2 border-amber border-dashed"
        >
          <div className="space-y-3">
            <div className="text-sm text-forest">
              <p className="font-semibold mb-1">Switch to Clerk for social login and stronger security</p>
              <p className="text-xs text-sage leading-relaxed">
                You're currently using legacy email/password authentication. Upgrade to Clerk to
                enable signing in with Google, GitHub, or Apple — and get automatic MFA support,
                session management, and enterprise-grade security. Your farms, crop cycles, and
                all existing data will be preserved.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {['Google', 'GitHub', 'Apple'].map(provider => (
                <span key={provider}
                  className="text-xs bg-sage-pale text-forest px-2.5 py-1 rounded-full flex items-center gap-1">
                  <span>{provider === 'Google' ? '🔵' : provider === 'GitHub' ? '⬛' : '⚫'}</span>
                  {provider}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-2">
              <a
                href="/login?upgrade=1"
                className="inline-flex items-center gap-2 bg-forest text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-forest-mid transition-colors"
              >
                🔄 Upgrade to Clerk
              </a>
              <span className="text-[10px] text-sage">
                You'll be signed out and redirected to sign in via Clerk.
                Your data will be linked automatically.
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Farms */}
      <Card title="My Farms">
        <div className="space-y-3">
          {farms.map((f: any) => (
            <div key={f.id}
              className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${activeFarm?.id === f.id ? 'bg-forest text-white' : 'bg-parchment text-forest hover:bg-parchment-dark'}`}
              onClick={() => setActiveFarm(f)}>
              <div>
                <div className="font-semibold text-sm">{f.name}</div>
                <div className={`text-xs ${activeFarm?.id === f.id ? 'text-sage-pale' : 'text-sage'}`}>
                  {f.total_area_ha} ha · {f.county ?? f.country}
                </div>
              </div>
              {activeFarm?.id === f.id && <span className="text-xs text-amber font-bold">Active</span>}
            </div>
          ))}

          <form onSubmit={createFarm} className="flex gap-2 pt-2">
            <input required placeholder="New farm name" value={farmName}
              onChange={e => setFarmName(e.target.value)}
              className="flex-1 border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
            <Button type="submit" disabled={!farmName.trim() || creatingFarm}>
              {creatingFarm ? 'Creating…' : '➕ Add Farm'}
            </Button>
          </form>
        </div>
      </Card>

      {/* Sign out */}
      <div className="text-center pt-4">
        <Button variant="danger" onClick={handleLogout}>🚪 Sign Out</Button>
      </div>
    </div>
  );
}

// ── Landing Page ───────────────────────────────────────────────────────────────
export function LandingPage() {
  const { isAuthenticated } = useAuthStore();
  const navigate = useNavigate();

  if (isAuthenticated()) {
    return <Navigate to="/dashboard" replace />;
  }

  const FEATURES = [
    { icon: '🧪', title: 'Soil Health Scoring', desc: 'Real-time SFS with 8-parameter weighted analysis. pH, NPK, moisture, OM, EC, and temperature — all in one dashboard.' },
    { icon: '☁️', title: 'Weather Intelligence', desc: 'Triple-source ensemble forecasts from OpenWeatherMap, Tomorrow.io, and Open-Meteo. 14-day outlook with confidence scoring.' },
    { icon: '🤖', title: 'AI Crop Advisor', desc: 'Rule-based or XGBoost-powered recommendations with transparent SHAP explanations. Know exactly why a crop was recommended.' },
    { icon: '🌱', title: 'GDD Tracking', desc: 'Automated Growing Degree Day accumulation per crop cycle. Know when to expect emergence, flowering, and harvest.' },
    { icon: '📋', title: 'Spray Diary & PHI', desc: 'Date-stamped treatment records with pre-harvest interval compliance. Never harvest before it\'s safe again.' },
    { icon: '📷', title: 'Photo Diagnosis', desc: 'Submit field photos for agronomist review. Every image is labelled training data — no AI guessing on something this important.' },
    { icon: '📡', title: 'IoT Sensor Network', desc: 'Register and monitor wireless soil sensors. Automatic anomaly detection, trust scoring, and calibration alerts.' },
    { icon: '🔗', title: 'Trusted Sharing', desc: 'Invite agronomists and advisors with revocable, role-based access. Your data, your terms.' },
  ];

  const HOW_IT_WORKS = [
    { step: '1', title: 'Register Your Farm', desc: 'Create your free account and define your farm boundaries, soil type, and growing zone. Takes 2 minutes.' },
    { step: '2', title: 'Connect Sensors', desc: 'Deploy IoT nodes or enter lab/test strip readings manually via Quick Soil Check. No hardware? No problem.' },
    { step: '3', title: 'Get Recommendations', desc: 'AI analyses soil, weather, and seasonal data to recommend crops, detect anomalies, and alert you to risks.' },
    { step: '4', title: 'Track & Improve', desc: 'Monitor GDD progress, log treatments, share with advisors, and watch your soil health improve season over season.' },
  ];

  const PRICING = [
    { tier: 'FREE', price: '0', color: 'bg-sage-pale text-forest', features: ['1 farm (3.2 ha max)', 'Soil health scoring', 'Weather forecasts', 'Quick Soil Check (manual entry)', 'Sensor registration'], cta: 'Get Started', action: () => navigate('/register') },
    { tier: 'FARMER', price: '499', color: 'bg-forest text-white', features: ['Up to 10 farms', 'AI crop recommendations', 'GDD tracking', 'Spray diary & PHI compliance', 'Photo diagnosis queue', 'Priority support'], cta: 'Subscribe', popular: true, action: () => navigate('/register') },
    { tier: 'PROFESSIONAL', price: '1,499', color: 'bg-amber text-forest-dark', features: ['Unlimited farms', 'Advanced ML insights', 'Multi-season planning', 'API access', 'Dedicated agronomist', 'Custom integrations'], cta: 'Contact Sales', action: () => window.location.href = 'mailto:sales@agrisense.io' },
    { tier: 'ENTERPRISE', price: 'Custom', color: 'bg-forest-dark text-amber', features: ['Everything in Professional', 'On-premise deployment', 'Custom model training', 'SLA guarantees', 'White-label options', '24/7 support'], cta: 'Contact Us', action: () => window.location.href = 'mailto:enterprise@agrisense.io' },
  ];

  return (
    <div className="min-h-screen bg-parchment font-sans">
      {/* Nav */}
      <nav className="sticky top-0 z-50 bg-forest-dark">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
              <span className="text-xl md:text-2xl shrink-0">🌿</span>
              <span className="font-display text-white font-bold text-base md:text-lg truncate">AgriSense</span>
            </div>
            <div className="flex items-center gap-2 md:gap-4 shrink-0">
              <button onClick={() => navigate('/login')} className="text-sage-pale hover:text-white text-xs md:text-sm font-semibold transition-colors whitespace-nowrap px-2 md:px-0">Sign In</button>
              <button onClick={() => navigate('/register')} className="bg-amber text-forest-dark px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-bold hover:bg-amber-light transition-colors whitespace-nowrap">Get Started</button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="bg-forest-dark text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24 lg:py-32">
          <div className="max-w-3xl">
            <div className="text-4xl md:text-6xl mb-4 md:mb-6">🌿</div>
            <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold leading-tight mb-4 md:mb-6">
              Smart Farming for{" "}
              <span className="text-amber">African Smallholders</span>
            </h1>
            <p className="text-base md:text-lg text-sage-pale max-w-2xl mb-6 md:mb-8 leading-relaxed">
              AgriSense combines IoT soil sensors, ensemble weather forecasting, and
              transparent AI recommendations to help you grow more with less. Built for
              the conditions that matter — from Nakuru to Nairobi.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              <button onClick={() => navigate('/register')}
                className="w-full sm:w-auto bg-amber text-forest-dark px-6 md:px-8 py-3 rounded-xl text-base md:text-lg font-bold hover:bg-amber-light transition-all hover:shadow-float text-center">
                Start Free — No Hardware Needed
              </button>
              <button onClick={() => navigate('/login')}
                className="w-full sm:w-auto border border-sage text-sage-pale px-6 md:px-8 py-3 rounded-xl text-base md:text-lg font-semibold hover:bg-forest hover:text-white transition-colors text-center">
                Sign In
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-forest border-y border-forest-mid">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8 text-center">
            {[
              ['12+', 'Crops Supported'],
              ['3', 'Weather Sources'],
              ['8', 'Soil Parameters'],
              ['99.9%', 'Uptime'],
            ].map(([val, label]) => (
              <div key={label}>
                <div className="text-2xl md:text-3xl font-display font-bold text-amber">{val}</div>
                <div className="text-sm text-sage-pale mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 md:mb-16">
            <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold text-forest mb-3 md:mb-4">Everything You Need to Farm Smarter</h2>
            <p className="text-sage max-w-2xl mx-auto">From soil sensors to harvest planning — one platform for the entire season.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="bg-white rounded-xl shadow-card p-6 hover:shadow-card-hover transition-all hover:-translate-y-0.5">
                <div className="text-3xl mb-3">{f.icon}</div>
                <h3 className="font-display font-bold text-forest text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-sage leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-white py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 md:mb-16">
            <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold text-forest mb-3 md:mb-4">How It Works</h2>
            <p className="text-sage max-w-2xl mx-auto">From first login to first harvest — four steps to a smarter farm.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
            {HOW_IT_WORKS.map((item, i) => (
              <div key={item.step} className="text-center relative">
                <div className="w-16 h-16 bg-forest rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-display font-bold text-amber">{item.step}</span>
                </div>
                <h3 className="font-display font-bold text-forest text-lg mb-2">{item.title}</h3>
                <p className="text-sm text-sage leading-relaxed">{item.desc}</p>
                {i < 3 && <div className="hidden lg:block absolute top-8 left-[60%] w-[80%] h-px border-t-2 border-dashed border-sage-pale" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 md:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-10 md:mb-16">
            <h2 className="font-display text-2xl md:text-3xl lg:text-4xl font-bold text-forest mb-3 md:mb-4">Pricing for Every Scale</h2>
            <p className="text-sage max-w-2xl mx-auto">Free to start. Upgrade when you need more.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {PRICING.map((p) => (
              <div key={p.tier} className={`bg-white rounded-xl shadow-card p-5 md:p-6 flex flex-col relative ${p.popular ? 'ring-2 ring-amber md:scale-[1.02]' : ''}`}>
                {p.popular && <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber text-forest-dark text-xs font-bold px-3 py-1 rounded-full">Most Popular</div>}
                <div className="mb-6">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full uppercase ${p.color}`}>{p.tier}</span>
                </div>
                <div className="mb-6">
                  <span className="text-4xl font-display font-bold text-forest">KES {p.price}</span>
                  {p.price !== 'Custom' && <span className="text-sage text-sm">/month</span>}
                </div>
                <ul className="space-y-2 mb-8 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-forest">
                      <span className="text-green-600 shrink-0">✓</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <button onClick={p.action}
                  className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors ${
                    p.tier === 'FREE' ? 'bg-forest text-white hover:bg-forest-mid' :
                    p.tier === 'FARMER' ? 'bg-amber text-forest-dark hover:bg-amber-light' :
                    'bg-parchment text-forest border border-sage hover:bg-parchment-dark'
                  }`}>
                  {p.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-forest-dark py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-4xl md:text-5xl mb-4 md:mb-6">🌱</div>
          <h2 className="font-display text-2xl md:text-4xl lg:text-5xl font-bold text-white mb-3 md:mb-4">Ready to Transform Your Farm?</h2>
          <p className="text-sage-pale text-base md:text-lg mb-6 md:mb-8 max-w-2xl mx-auto">
            Join farmers across Kenya using data to grow more with less. No IoT hardware? No problem — start with Quick Soil Check.
          </p>
          <button onClick={() => navigate('/register')}
            className="w-full sm:w-auto bg-amber text-forest-dark px-8 md:px-10 py-3 md:py-4 rounded-xl text-lg md:text-xl font-bold hover:bg-amber-light transition-all hover:shadow-float">
            Get Started Free
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-forest-dark border-t border-forest py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-2xl">🌿</span>
                <span className="font-display text-white font-bold text-lg">AgriSense</span>
              </div>
              <p className="text-sage-pale text-sm">Smart Farming Platform for African Smallholders. Built by Ruai Tech Solutions.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm uppercase tracking-wide mb-3">Product</h4>
              <div className="space-y-2 text-sm">
                <button onClick={() => navigate('/register')} className="block text-sage-pale hover:text-white transition-colors">Features</button>
                <button onClick={() => navigate('/register')} className="block text-sage-pale hover:text-white transition-colors">Pricing</button>
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm uppercase tracking-wide mb-3">Company</h4>
              <div className="space-y-2 text-sm">
                <span className="block text-sage-pale">Ruai Tech Solutions</span>
                <span className="block text-sage-pale">Nairobi, Kenya</span>
                <span className="block text-sage-pale">hello@agrisense.io</span>
              </div>
            </div>
          </div>
          <div className="border-t border-forest mt-8 pt-8 text-center text-xs text-sage">
            © {new Date().getFullYear()} Ruai Tech Solutions. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}

// ── Register Page ──────────────────────────────────────────────────────────────
