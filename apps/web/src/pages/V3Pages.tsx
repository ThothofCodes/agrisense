/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFarmStore } from '../store';
import { api } from '../api';
import { Card, EmptyState, Spinner, Button } from '../components/ui';

// ── Treatment / Spray Diary ──────────────────────────────────────────────────
export function TreatmentsPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const [form, setForm] = useState({
    treatment_type: 'FERTILISER', product_name: '', application_rate: '', rate_unit: 'kg/ha',
    pre_harvest_interval_days: '', notes: '',
  });
  const [submitting, setSubmitting] = useState(false);

  const { data: treatments, refetch, isLoading } = useQuery({
    queryKey: ['treatments', farmId], queryFn: () => api.treatments.list(farmId!), enabled: !!farmId,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmId || !form.product_name) return;
    setSubmitting(true);
    try {
      await api.treatments.create({
        farm_id: farmId, treatment_type: form.treatment_type, product_name: form.product_name,
        application_rate: form.application_rate ? +form.application_rate : undefined,
        rate_unit: form.rate_unit, pre_harvest_interval_days: form.pre_harvest_interval_days ? +form.pre_harvest_interval_days : undefined,
        notes: form.notes,
      });
      setForm({ treatment_type: 'FERTILISER', product_name: '', application_rate: '', rate_unit: 'kg/ha', pre_harvest_interval_days: '', notes: '' });
      refetch();
    } finally { setSubmitting(false); }
  };

  const TYPE_ICON: Record<string, string> = {
    PESTICIDE: '🐛', HERBICIDE: '🌿', FUNGICIDE: '🍄', FERTILISER: '🧪', ORGANIC: '🍃', BIOLOGICAL_CONTROL: '🦋', OTHER: '📦',
  };

  // Compute summary stats
  const totalTreatments = treatments?.length ?? 0;
  const activePHIs = treatments?.filter((t: any) => {
    if (!t.pre_harvest_interval_days) return false;
    const safeDate = new Date(new Date(t.applied_at).getTime() + t.pre_harvest_interval_days * 86400000);
    return safeDate.getTime() > Date.now();
  }).length ?? 0;
  const byType = treatments?.reduce((acc: Record<string, number>, t: any) => {
    acc[t.treatment_type] = (acc[t.treatment_type] ?? 0) + 1;
    return acc;
  }, {}) ?? {};

  if (!farmId) return <EmptyState icon="📋" title="No farm selected" />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Treatment & Spray Diary</h1>
      <p className="text-sage text-sm -mt-4">A dated record of every input applied — with pre-harvest-interval (PHI) compliance built in.</p>

      {/* Summary dashboard */}
      {totalTreatments > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-forest">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Total Treatments</div>
            <div className="text-2xl font-display font-bold text-forest mt-1">{totalTreatments}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-amber">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Active PHI</div>
            <div className="text-2xl font-display font-bold text-amber mt-1">{activePHIs}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-sage lg:col-span-2">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">By Type</div>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.entries(byType).map(([type, count]) => (
                <span key={type} className="text-xs bg-sage-pale text-forest px-2 py-0.5 rounded-full">
                  {String(TYPE_ICON[type] ?? '📦')} {type.replace(/_/g, ' ')}: {String(count)}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card title="Log a New Treatment">
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select value={form.treatment_type} onChange={e => setForm(p => ({ ...p, treatment_type: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm">
            {Object.keys(TYPE_ICON).map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>)}
          </select>
          <input required placeholder="Product name (e.g. Cypermethrin 10% EC)" value={form.product_name}
            onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Rate (e.g. 1.5)" type="number" step="0.01" value={form.application_rate}
            onChange={e => setForm(p => ({ ...p, application_rate: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Unit (e.g. L/ha)" value={form.rate_unit}
            onChange={e => setForm(p => ({ ...p, rate_unit: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Pre-harvest interval (days)" type="number" value={form.pre_harvest_interval_days}
            onChange={e => setForm(p => ({ ...p, pre_harvest_interval_days: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm sm:col-span-2" />
          <textarea placeholder="Notes (reason for application, target pest, etc.)" value={form.notes}
            onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            className="border border-parchment-dark rounded-lg px-3 py-2 text-sm sm:col-span-2" rows={2} />
          <Button type="submit" disabled={submitting} className="sm:col-span-2">{submitting ? 'Saving…' : 'Log Treatment'}</Button>
        </form>
      </Card>

      <Card title="Treatment History">
        {isLoading ? <Spinner /> : treatments?.length ? (
          <div className="space-y-2">
            {treatments.map((t: any) => {
              const safeDate = t.pre_harvest_interval_days ? new Date(new Date(t.applied_at).getTime() + t.pre_harvest_interval_days * 86400000) : null;
              const stillRestricted = safeDate && safeDate.getTime() > Date.now();
              return (
                <div key={t.id} className="flex items-start gap-3 p-3 bg-parchment rounded-lg">
                  <span className="text-2xl">{TYPE_ICON[t.treatment_type] ?? '📦'}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-forest text-sm">{t.product_name}</span>
                      <span className="text-[10px] text-sage">{new Date(t.applied_at).toLocaleDateString()}</span>
                    </div>
                    {t.application_rate && <div className="text-xs text-sage">{t.application_rate} {t.rate_unit}</div>}
                    {t.notes && <div className="text-xs text-sage italic mt-0.5">{t.notes}</div>}
                    {safeDate && (
                      <div className={`text-xs mt-1 font-semibold ${stillRestricted ? 'text-red-600' : 'text-green-600'}`}>
                        {stillRestricted
                          ? `🚫 PHI active — safe to harvest from ${safeDate.toLocaleDateString()}`
                          : '✅ PHI cleared — safe to harvest'}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon="📋" title="No treatments logged yet" sub="Start by logging a fertiliser or pesticide application above. PHI compliance will be tracked automatically." />}
      </Card>

      {activePHIs > 0 && (
        <div className="bg-amber-pale border border-amber rounded-xl p-4 text-sm text-forest">
          <strong>⚠️ {activePHIs} treatment(s) with active PHI restrictions.</strong>
          <p className="text-xs text-sage mt-1">
            These crops must not be harvested until the pre-harvest interval has elapsed. Check each treatment's safe date above.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Photo Diagnosis ──────────────────────────────────────────────────────────
export function DiagnosesPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const [imageUrl, setImageUrl] = useState('');
  const [tags, setTags] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState<string | null>(null);

  const { data: diagnoses, refetch, isLoading } = useQuery({
    queryKey: ['diagnoses', farmId], queryFn: () => api.diagnoses.list(farmId!), enabled: !!farmId,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!farmId || !imageUrl) return;
    setSubmitting(true);
    try {
      const res = await api.diagnoses.create({
        farm_id: farmId, image_ref: imageUrl,
        symptom_tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      setJustSubmitted(res.message);
      setImageUrl(''); setTags('');
      refetch();
    } finally { setSubmitting(false); }
  };

  const STATUS_BADGE: Record<string, string> = {
    PENDING_REVIEW: 'bg-amber-pale text-amber', AGRONOMIST_REVIEWED: 'bg-green-100 text-green-700',
    MODEL_DIAGNOSED: 'bg-sage-pale text-forest', DISMISSED: 'bg-parchment-dark text-sage',
  };

  // Queue stats
  const total = diagnoses?.length ?? 0;
  const pending = diagnoses?.filter((d: any) => d.status === 'PENDING_REVIEW').length ?? 0;
  const reviewed = diagnoses?.filter((d: any) => d.status === 'AGRONOMIST_REVIEWED').length ?? 0;

  if (!farmId) return <EmptyState icon="📷" title="No farm selected" />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Photo Pest & Disease Diagnosis</h1>
      <div className="bg-sage-pale rounded-lg p-3 text-sm text-forest">
        {"ℹ️ AgriSense does not yet have a trained image-diagnosis model. Every photo is reviewed by a human agronomist and retained as labelled training data — we'd rather say \"not yet\" than guess on something this important."}
      </div>

      {/* Queue summary */}
      {total > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-amber text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Total</div>
            <div className="text-2xl font-display font-bold text-forest mt-1">{total}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-amber text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Pending</div>
            <div className="text-2xl font-display font-bold text-amber mt-1">{pending}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-green-500 text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Reviewed</div>
            <div className="text-2xl font-display font-bold text-green-600 mt-1">{reviewed}</div>
          </div>
        </div>
      )}

      <Card title="Submit a Photo for Diagnosis">
        <form onSubmit={submit} className="space-y-3">
          <input required placeholder="Image URL (upload elsewhere, paste link here)" value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
          <input placeholder="Symptoms, comma-separated (e.g. yellow leaves, holes in leaves, wilting)" value={tags}
            onChange={e => setTags(e.target.value)}
            className="w-full border border-parchment-dark rounded-lg px-3 py-2 text-sm" />
          <div className="flex items-center gap-4">
            <Button type="submit" disabled={submitting}>{submitting ? 'Submitting…' : 'Submit for Agronomist Review'}</Button>
            <span className="text-[10px] text-sage">Typical turnaround: 24–48 hours</span>
          </div>
        </form>
        {justSubmitted && <p className="text-xs text-sage mt-2 bg-parchment rounded p-2">{justSubmitted}</p>}
      </Card>

      <Card title="Submission History">
        {isLoading ? <Spinner /> : diagnoses?.length ? (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {diagnoses.map((d: any) => {
              const reviewedQuickly = d.status === 'AGRONOMIST_REVIEWED' && d.agronomist_notes;
              return (
                <div key={d.id} className="p-3 bg-parchment rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-sage">{new Date(d.created_at).toLocaleString()}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[d.status]}`}>
                      {d.status === 'PENDING_REVIEW' ? 'Pending Review' :
                       d.status === 'AGRONOMIST_REVIEWED' ? 'Agronomist Reviewed' :
                       d.status === 'MODEL_DIAGNOSED' ? 'AI Diagnosis' : 'Dismissed'}
                    </span>
                  </div>
                  {d.image_ref && <div className="text-[10px] text-sage mb-1 truncate">📷 {d.image_ref}</div>}
                  {d.symptom_tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                      {d.symptom_tags.map((tag: string) => (
                        <span key={tag} className="text-[9px] bg-sage-pale text-forest px-1.5 py-0.5 rounded-full">{tag}</span>
                      ))}
                    </div>
                  )}
                  {reviewedQuickly && (
                    <div className="text-xs text-forest bg-white rounded p-2 mt-1 border border-green-100">
                      👨‍🌾 <strong>Agronomist notes:</strong> {d.agronomist_notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon="📷" title="No photos submitted yet" sub="Submit a photo of affected plants above. An agronomist will review it within 24–48 hours." />}
      </Card>
    </div>
  );
}

// ── Trusted Advisor Sharing ────────────────────────────────────────────────────
export function SharesPage() {
  const { activeFarm } = useFarmStore();
  const farmId = activeFarm?.id;
  const [role, setRole] = useState('AGRONOMIST');
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState<string | null>(null);

  const { data: shares, refetch, isLoading } = useQuery({
    queryKey: ['shares', farmId], queryFn: () => api.shares.list(farmId!), enabled: !!farmId,
  });

  const create = async () => {
    if (!farmId) return;
    setCreating(true);
    try {
      const res = await api.shares.create(farmId, role);
      setNewLink(`${window.location.origin}${res.share_url}`);
      refetch();
    } finally { setCreating(false); }
  };

  const revoke = async (id: string) => { await api.shares.revoke(id); refetch(); };

  // Compute share stats
  const activeShares = shares?.filter((s: any) => !s.revoked).length ?? 0;
  const acceptedShares = shares?.filter((s: any) => s.accepted_by).length ?? 0;

  if (!farmId) return <EmptyState icon="🔗" title="No farm selected" />;

  return (
    <div className="space-y-6">
      <h1 className="font-display text-2xl font-bold text-forest">Trusted Advisor Access</h1>
      <p className="text-sage text-sm -mt-4">{"You own your farm's data. Share read-only or agronomist access on your terms — revocable any time."}</p>

      {/* Info panel */}
      <div className="bg-amber-pale border border-amber rounded-xl p-4 text-sm text-forest flex items-start gap-3">
        <span className="text-xl shrink-0">🔐</span>
        <div>
          <strong>Your data, your rules.</strong>
          <p className="text-xs text-sage mt-0.5">
            Shares are time-limited and role-scoped. An agronomist can review diagnoses and see soil data but cannot modify your farm or export data.
            Revoke access at any time — it takes effect immediately.
          </p>
        </div>
      </div>

      {/* Stats */}
      {shares && shares.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-forest text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Active Shares</div>
            <div className="text-2xl font-display font-bold text-forest mt-1">{activeShares}</div>
          </div>
          <div className="bg-white rounded-xl shadow-card p-4 border-l-4 border-sage text-center">
            <div className="text-[10px] text-sage uppercase tracking-wide font-semibold">Accepted</div>
            <div className="text-2xl font-display font-bold text-sage mt-1">{acceptedShares}/{shares.length}</div>
          </div>
        </div>
      )}

      <Card title="Invite an Advisor">
        <div className="flex gap-2 flex-wrap">
          <select value={role} onChange={e => setRole(e.target.value)} className="border border-parchment-dark rounded-lg px-3 py-2 text-sm">
            <option value="READ_ONLY">Read Only — can view soil data and alerts</option>
            <option value="AGRONOMIST">Agronomist — can review diagnoses and full soil data</option>
          </select>
          <Button onClick={create} disabled={creating}>{creating ? 'Creating…' : 'Generate Share Link'}</Button>
        </div>
        {newLink && (
          <div className="mt-3">
            <p className="text-[10px] text-sage mb-1">Share this link with your advisor (expires in 30 days):</p>
            <div className="p-3 bg-sage-pale rounded-lg text-sm font-mono text-forest break-all select-all">{newLink}</div>
          </div>
        )}
      </Card>

      <Card title="Active & Past Shares">
        {isLoading ? <Spinner /> : shares?.length ? (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {shares.map((s: any) => {
              const isAccepted = !!s.accepted_by;
              const isExpired = new Date(s.expires_at).getTime() < Date.now();
              return (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-parchment">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-forest">{s.role === 'AGRONOMIST' ? '👨‍🌾' : '👁️'} {s.role.replace(/_/g, ' ')}</span>
                      {isAccepted && <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold">Accepted</span>}
                      {s.revoked && <span className="text-[10px] bg-parchment-dark text-sage px-2 py-0.5 rounded-full">Revoked</span>}
                    </div>
                    <div className="text-xs text-sage mt-0.5">
                      {isAccepted
                        ? `Accepted ${new Date(s.accepted_at).toLocaleDateString()}`
                        : 'Not yet accepted'}
                      {isExpired && !s.revoked ? <span className="text-amber ml-2">⚠️ Expired</span> : ''}
                      {s.expires_at && <span className="ml-2">· Expires {new Date(s.expires_at).toLocaleDateString()}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!s.revoked && !isExpired && (
                      <button onClick={() => revoke(s.id)}
                        className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100 transition-colors">
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState icon="🔗" title="No shares yet" sub="Generate a share link above to invite an agronomist or advisor to view your farm data." />}
      </Card>
    </div>
  );
}
