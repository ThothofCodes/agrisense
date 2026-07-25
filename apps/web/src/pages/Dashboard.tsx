/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useFarmStore } from '../store';
import { api, apiClient } from '../api';
import { StatCard, Card, SFSGauge, GDDBar, AlertBadge, Spinner, EmptyState } from '../components/ui';
import { useWebSocket } from '../hooks/useWebSocket';

const CHART_COLORS = { forest: '#1B4332', amber: '#D4A017', sage: '#52796F', pale: '#D8F3DC' };

function FarmLifecycleTip({ crop, sfsScore }: { crop: any; sfsScore: number | null }) {
  if (!crop && !sfsScore) {
    return (
      <Card title="🚀 Getting Started">
        <div className="text-sm text-forest space-y-3">
          <p>Your farm is set up and ready. Here's what to do next:</p>
          <ol className="space-y-2 list-decimal list-inside text-sage">
            <li><strong className="text-forest">Register a sensor node</strong> — Go to <strong>Sensors</strong> to add IoT hardware</li>
            <li><strong className="text-forest">Submit sensor readings</strong> — Or use <strong>Quick Soil Check</strong> for a manual entry</li>
            <li><strong className="text-forest">Start a crop cycle</strong> — Go to <strong>Crop Growth</strong> and begin tracking GDD</li>
            <li><strong className="text-forest">Run AI analysis</strong> — The <strong>AI Advisor</strong> will recommend the best crops for your soil</li>
          </ol>
          <div className="bg-sage-pale rounded-lg p-3 text-xs flex items-start gap-2">
            <span className="text-lg shrink-0">💡</span>
            <span>No IoT hardware? Use <strong>Quick Soil Check</strong> on the Soil Health page to enter lab or test-strip readings manually.</span>
          </div>
        </div>
      </Card>
    );
  }
  return null;
}

function SystemStatus() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['system-health'],
    queryFn: () => apiClient.get('/health').then(r => r.data),
    refetchInterval: 60000,
  });

  const services = [
    { name: 'Database', key: 'db', ok: health?.services?.db },
    { name: 'Redis', key: 'redis', ok: health?.services?.redis },
    { name: 'ML Service', key: 'ml', ok: health?.services?.ml ?? null },
  ];

  return (
    <Card title="System Status" className="text-xs">
      {isLoading ? <Spinner size="sm" /> : (
        <div className="space-y-2">
          {services.map(s => (
            <div key={s.name} className="flex items-center justify-between">
              <span className="text-sage">{s.name}</span>
              <span className={`flex items-center gap-1 font-semibold ${s.ok === true ? 'text-green-600' : s.ok === false ? 'text-red-500' : 'text-sage'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${s.ok === true ? 'bg-green-500' : s.ok === false ? 'bg-red-500' : 'bg-sage'}`} />
                {s.ok === true ? 'Operational' : s.ok === false ? 'Down' : 'Checking…'}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-1 border-t border-parchment-dark">
            <span className="text-sage">Last checked</span>
            <span className="text-forest font-mono">{new Date().toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function FarmInfo({ farmId }: { farmId: string }) {
  const { data: nodes } = useQuery({
    queryKey: ['sensor-nodes', farmId],
    queryFn: () => api.sensors.list(farmId!).catch(() => []),
    enabled: !!farmId,
    refetchInterval: 60000,
  });

  const nodeList = Array.isArray(nodes) ? nodes : [];
  const onlineCount = nodeList.filter((n: any) => n.status === 'ONLINE').length;
  const hasTrust = nodeList.some((n: any) => (n.trust_score ?? 0) >= 60);

  return (
    <Card title="📋 Farm Overview">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-parchment rounded-lg p-3 text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Nodes</div>
            <div className="text-xl font-bold font-mono text-forest">{nodeList.length}</div>
          </div>
          <div className="bg-parchment rounded-lg p-3 text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide">Online</div>
            <div className="text-xl font-bold font-mono text-green-600">{onlineCount}</div>
          </div>
        </div>
        {nodeList.length > 0 && (
          <div className="space-y-1 text-[10px] text-sage">
            {nodeList.slice(0, 4).map((n: any) => (
              <div key={n.id} className="flex items-center justify-between">
                <span className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${n.status === 'ONLINE' ? 'bg-green-500' : 'bg-red-400'}`} />
                  {n.name ?? n.device_id}
                </span>
                <span>{n.trust_score ?? '?'}% trust</span>
              </div>
            ))}
          </div>
        )}
        {nodeList.length === 0 && (
          <p className="text-xs text-sage text-center py-2">No sensor nodes yet. Register one on the Sensors page.</p>
        )}
        {!hasTrust && nodeList.length > 0 && (
          <p className="text-[10px] text-amber bg-amber-pale rounded p-2">
            Sensors still building trust score. Submit more readings to improve recommendation confidence.
          </p>
        )}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id ?? null;
  const [liveReadings, setLiveReadings] = useState<Record<string, number>>({});

  const { data: summary, isLoading: sumLoading } = useQuery({
    queryKey: ['farm-summary', farmId],
    queryFn:  () => api.farms.summary(farmId!),
    enabled:  !!farmId,
    refetchInterval: 60000,
  });

  const { data: sfsData } = useQuery({
    queryKey: ['sfs', farmId],
    queryFn:  () => api.sfs.get(farmId!),
    enabled:  !!farmId,
    refetchInterval: 300000,
  });
  const sfs = sfsData?.sfs;

  const { data: forecast } = useQuery({
    queryKey: ['forecast', farmId],
    queryFn:  () => api.weather.forecast(farmId!, 7),
    enabled:  !!farmId,
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts', farmId, 'ACTIVE'],
    queryFn:  () => api.alerts.list(farmId!, 'ACTIVE'),
    enabled:  !!farmId,
    refetchInterval: 30000,
  });

  useWebSocket(farmId, {
    SENSOR_UPDATE: (payload) => {
      setLiveReadings(prev => ({ ...prev, [payload.sensor_type]: payload.value }));
    },
    ALERT_FIRED: () => {
      // Trigger a refetch — handled by react-query invalidation in a real setup
    },
  });

  if (!farmId) return <EmptyState icon="🌾" title="No farm selected" sub="Create or select a farm to see your dashboard." />;
  if (sumLoading) return <Spinner size="lg" />;

  const crop = summary?.active_crop;
  const nodes = summary?.node_stats;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-forest">{activeFarm?.name}</h1>
          <p className="text-sage text-sm">{activeFarm?.total_area_ha} ha · {activeFarm?.county ?? activeFarm?.country} · {activeFarm?.season_zone} zone</p>
        </div>
        {Object.keys(liveReadings).length > 0 && (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="text-[10px] text-sage uppercase tracking-wide flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse-dot" /> Live
            </span>
            {Object.entries(liveReadings).slice(0, 4).map(([type, value]) => (
              <span key={type} className="text-xs bg-sage-pale text-forest px-2 py-1 rounded-full font-mono">
                {type.replace(/_/g, ' ').toLowerCase()}: <strong>{value}</strong>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Soil Health Score" value={sfs?.total_score ?? '—'} icon="🧪" accent="forest" sub={sfs?.interpretation} />
        <StatCard label="Active Alerts" value={summary?.active_alerts ?? 0} icon="🔔" accent={summary?.active_alerts > 0 ? 'amber' : 'forest'} />
        <StatCard label="7-day Rainfall" value={summary?.weekly_rainfall_mm?.toFixed(1) ?? '—'} unit="mm" icon="🌧️" accent="sage" />
        <StatCard label="Sensors Online" value={`${nodes?.online ?? 0}/${nodes?.total ?? 0}`} icon="📡" accent="forest" />
      </div>

      {/* Getting started or main content */}
      <FarmLifecycleTip crop={crop} sfsScore={sfs?.total_score ?? null} />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SFS Gauge + breakdown */}
        <Card title="Soil Feasibility">
          {sfs ? (
            <div>
              <SFSGauge score={sfs.total_score} />
              {sfsData.data_completeness_pct < 70 && (
                <p className="text-xs text-amber text-center mb-2">
                  ⚠️ {sfsData.data_completeness_pct}% data coverage, {sfsData.avg_sensor_trust_score}% sensor trust — treat as indicative
                </p>
              )}
              <div className="space-y-2">
                {[
                  { label: 'pH Balance',    val: sfs.ph_score },
                  { label: 'Nitrogen',      val: sfs.nitrogen_score },
                  { label: 'Phosphorus',    val: sfs.phosphorus_score },
                  { label: 'Potassium',     val: sfs.potassium_score },
                  { label: 'Moisture',      val: sfs.moisture_score },
                  { label: 'Organic Matter',val: sfs.organic_matter_score },
                  { label: 'Salinity (EC)', val: sfs.ec_score },
                  { label: 'Soil Temp',     val: sfs.soil_temp_score },
                ].map(({ label, val }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs text-sage w-28 shrink-0">{label}</span>
                    <div className="flex-1 h-2 bg-sage-pale rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${val}%`, background: val >= 70 ? CHART_COLORS.forest : val >= 50 ? CHART_COLORS.sage : CHART_COLORS.amber }} />
                    </div>
                    <span className="text-xs font-mono text-forest w-7 text-right">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <Spinner />}
        </Card>

        {/* Weather forecast */}
        <Card title="7-Day Forecast" className="lg:col-span-2">
          {forecast ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={forecast} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <defs>
                  <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.forest} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.forest} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.amber} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={CHART_COLORS.amber} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#D8F3DC" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: CHART_COLORS.sage }}
                  tickFormatter={(d) => new Date(d).toLocaleDateString('en', { weekday: 'short' })} />
                <YAxis tick={{ fontSize: 10, fill: CHART_COLORS.sage }} />
                <Tooltip contentStyle={{ fontSize: 12, borderColor: CHART_COLORS.pale }} />
                <Area type="monotone" dataKey="temp_max" name="Max °C" stroke={CHART_COLORS.forest} fill="url(#tempGrad)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="rainfall_mm" name="Rain mm" stroke={CHART_COLORS.amber} fill="url(#rainGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Spinner />}

          {/* Daily weather cards */}
          {forecast && (
            <div className="flex gap-2 mt-4 overflow-x-auto pb-1">
              {forecast.slice(0, 7).map((d: any) => (
                <div key={d.date} className="shrink-0 w-20 bg-parchment rounded-lg p-2 text-center">
                  <div className="text-[10px] text-sage">{new Date(d.date).toLocaleDateString('en', { weekday: 'short', day: 'numeric' })}</div>
                  <div className="text-xl my-1">
                    {d.rainfall_mm > 10 ? '🌧️' : d.rainfall_mm > 2 ? '⛅' : '☀️'}
                  </div>
                  <div className="text-xs font-bold text-forest">{d.temp_max?.toFixed(0)}°</div>
                  <div className="text-[10px] text-sage">{d.temp_min?.toFixed(0)}° low</div>
                  {d.rainfall_mm > 0 && <div className="text-[10px] text-blue-500">{d.rainfall_mm?.toFixed(1)}mm</div>}
                  {d.low_confidence && <div className="text-[8px] text-amber mt-0.5">⚠️ Low confidence</div>}
                </div>
              ))}
            </div>
          )}
          {forecast && forecast.some((d: any) => d.low_confidence) && (
            <p className="text-[10px] text-amber mt-2 flex items-center gap-1">
              <span>⚠️</span> Some days show low confidence — weather sources disagree materially. Check back for updated forecasts.
            </p>
          )}
        </Card>
      </div>

      {/* Bottom row: Crop GDD + Alerts + Data Summary + System */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card title="Active Crop Cycle" className="lg:col-span-2">
          {crop ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-4xl">🌱</span>
                <div>
                  <div className="font-display font-bold text-forest text-lg">{crop.crop_name}</div>
                  <div className="text-sage text-xs">
                    Planted: {crop.planted_at ? new Date(crop.planted_at).toLocaleDateString() : 'Unknown'}
                    {crop.expected_harvest && ` · Harvest: ${new Date(crop.expected_harvest).toLocaleDateString()}`}
                  </div>
                </div>
              </div>
              <GDDBar
                pct={crop.gdd_maturity ? (parseFloat(crop.gdd_accumulated) / crop.gdd_maturity) * 100 : 0}
                stage={crop.current_stage ?? 'VEGETATIVE'}
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-parchment rounded-lg p-3">
                  <div className="text-[10px] text-sage uppercase tracking-wide">GDD Accumulated</div>
                  <div className="text-xl font-mono font-bold text-forest">{parseFloat(crop.gdd_accumulated).toFixed(0)}</div>
                </div>
                <div className="bg-parchment rounded-lg p-3">
                  <div className="text-[10px] text-sage uppercase tracking-wide">GDD to Maturity</div>
                  <div className="text-xl font-mono font-bold text-forest">{crop.gdd_maturity ?? '—'}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-sage mb-2">No active crop cycle.</p>
              <p className="text-xs text-sage">Go to <strong>Crop Growth</strong> to start tracking GDD for a new season.</p>
            </div>
          )}
        </Card>

        <Card title="Active Alerts">
          {alerts && alerts.length > 0 ? (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {alerts.slice(0, 8).map((a: any) => (
                <div key={a.id} className="flex items-start gap-3 p-3 bg-parchment rounded-lg">
                  <AlertBadge severity={a.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-forest truncate">{a.title}</div>
                    <div className="text-xs text-sage line-clamp-2">{a.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon="✅" title="No active alerts" sub="All parameters within normal range." />}
          <div className="mt-3 text-center">
            <a href="/alerts" className="text-xs text-forest font-semibold hover:underline">View all alerts →</a>
          </div>
        </Card>

        <div className="space-y-6">
          <FarmInfo farmId={farmId} />
          <SystemStatus />
        </div>
      </div>
    </div>
  );
}
