/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React from 'react';
import { clsx } from 'clsx';

// ── StatCard ──────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string; value: string | number; unit?: string;
  icon?: string; trend?: number; accent?: 'forest' | 'amber' | 'sage';
  sub?: string;
}
export function StatCard({ label, value, unit, icon, trend, accent = 'forest', sub }: StatCardProps) {
  const colors = { forest: 'border-forest', amber: 'border-amber', sage: 'border-sage' };
  return (
    <div className={clsx('bg-white rounded-xl shadow-card border-l-4 p-5 animate-fade-up', colors[accent])}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-sage uppercase tracking-wider font-semibold">{label}</p>
          <p className="text-3xl font-display font-bold text-forest mt-1">
            {value}<span className="text-lg text-sage ml-1">{unit}</span>
          </p>
          {sub && <p className="text-xs text-sage mt-1">{sub}</p>}
          {trend !== undefined && (
            <p className={clsx('text-xs mt-1 font-semibold', trend >= 0 ? 'text-green-600' : 'text-red-500')}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}% vs last week
            </p>
          )}
        </div>
        {icon && <span className="text-3xl opacity-80">{icon}</span>}
      </div>
    </div>
  );
}

// ── SFSGauge ─────────────────────────────────────────────────────────────────
export function SFSGauge({ score }: { score: number }) {
  const colour = score >= 80 ? '#1B4332' : score >= 60 ? '#52796F' : score >= 40 ? '#D4A017' : '#dc2626';
  const label  = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Poor';
  const r = 54; const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <div className="flex flex-col items-center">
      <svg width={130} height={130} className="-rotate-90">
        <circle cx={65} cy={65} r={r} fill="none" stroke="#D8F3DC" strokeWidth={12} />
        <circle cx={65} cy={65} r={r} fill="none" stroke={colour} strokeWidth={12}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s ease' }} />
      </svg>
      <div className="text-center -mt-20 mb-12">
        <div className="text-4xl font-display font-bold" style={{ color: colour }}>{score}</div>
        <div className="text-sm font-semibold" style={{ color: colour }}>{label}</div>
      </div>
    </div>
  );
}

// ── AlertBadge ────────────────────────────────────────────────────────────────
export function AlertBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-600 text-white',
    WARNING:  'bg-red-100 text-red-700',
    WATCH:    'bg-amber-pale text-amber-700',
    ADVISORY: 'bg-sage-pale text-forest',
  };
  return <span className={clsx('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full', map[severity] ?? map.ADVISORY)}>{severity}</span>;
}

// ── StageBadge ────────────────────────────────────────────────────────────────
export function StageBadge({ stage }: { stage: string }) {
  const label = stage.replace(/_/g, ' ');
  return <span className="text-xs bg-sage-pale text-forest px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide">{label}</span>;
}

// ── GDDBar ────────────────────────────────────────────────────────────────────
export function GDDBar({ pct, stage }: { pct: number; stage: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-sage mb-1">
        <span>Planting</span><span className="font-semibold text-forest">{pct.toFixed(0)}%</span><span>Harvest</span>
      </div>
      <div className="h-3 bg-sage-pale rounded-full overflow-hidden">
        <div className="h-full bg-forest rounded-full transition-all duration-700"
          style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <StageBadge stage={stage} />
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
export function Card({ title, children, className, action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={clsx('bg-white rounded-xl shadow-card p-5 animate-fade-up', className)}>
      {title && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-semibold text-forest text-base">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const s = { sm: 'w-4 h-4', md: 'w-8 h-8', lg: 'w-12 h-12' }[size];
  return (
    <div className="flex justify-center items-center py-8">
      <div className={clsx('rounded-full border-4 border-sage-pale border-t-forest animate-spin', s)} />
    </div>
  );
}

// ── EmptyState ─────────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub, action }: { icon: string; title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-5xl mb-4">{icon}</div>
      <h3 className="font-display text-forest font-semibold text-lg mb-1">{title}</h3>
      {sub && <p className="text-sage text-sm mb-4 max-w-xs">{sub}</p>}
      {action}
    </div>
  );
}

// ── Button ─────────────────────────────────────────────────────────────────────
export function Button({ children, onClick, variant = 'primary', size = 'md', disabled, className, type = 'button' }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg'; disabled?: boolean; className?: string; type?: 'button' | 'submit';
}) {
  const variants = {
    primary:   'bg-forest text-white hover:bg-forest-mid',
    secondary: 'bg-parchment border border-sage text-forest hover:bg-parchment-dark',
    danger:    'bg-red-600 text-white hover:bg-red-700',
  };
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm', lg: 'px-6 py-3 text-base' };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={clsx('rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], sizes[size], className)}>
      {children}
    </button>
  );
}
