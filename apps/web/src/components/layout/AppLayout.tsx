/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React, { useState, useEffect } from 'react';
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
import { useUser, useAuth, useSession } from '@clerk/clerk-react';
import { useAuthStore, useFarmStore } from '../../store';
import { api, setClerkToken } from '../../api';
import { clsx } from 'clsx';

const NAV = [
  { to: '/dashboard',        icon: '⊞',  label: 'Overview'      },
  { to: '/soil',             icon: '🧪', label: 'Soil Health'    },
  { to: '/crops',            icon: '🌱', label: 'Crop Growth'    },
  { to: '/weather',          icon: '☁️', label: 'Weather'        },
  { to: '/advisor',          icon: '🤖', label: 'AI Advisor'     },
  { to: '/calendar',         icon: '📅', label: 'Planting Cal.'  },
  { to: '/treatments',       icon: '📋', label: 'Spray Diary'    },
  { to: '/diagnoses',        icon: '📷', label: 'Diagnose'       },
  { to: '/shares',           icon: '🔗', label: 'Share Access'   },
  { to: '/field-map',        icon: '🗺️', label: 'Field Map'      },
  { to: '/alerts',           icon: '🔔', label: 'Alerts'         },
  { to: '/sensors',          icon: '📡', label: 'Sensors'        },
  { to: '/settings',         icon: '⚙️', label: 'Settings'       },
];

const TIER_COLORS: Record<string, string> = {
  FREE: 'bg-sage-pale text-forest',
  FARMER: 'bg-forest text-white',
  PROFESSIONAL: 'bg-amber text-forest-dark',
  ENTERPRISE: 'bg-forest-dark text-amber',
};

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [tokenReady, setTokenReady] = useState(false);
  const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const { user: clerkUser } = CLERK_ENABLED ? useUser() : { user: null };
  const { signOut } = CLERK_ENABLED ? useAuth() : { signOut: null };
  const { session } = CLERK_ENABLED ? useSession() : { session: null };
  const { user: storeUser, clearAuth } = useAuthStore();
  const { activeFarm, farms, setFarms, setActiveFarm } = useFarmStore();
  const navigate = useNavigate();

  // Sync Clerk session token into the axios interceptor so every API call uses
  // the Clerk-issued JWT instead of the legacy localStorage token.
  // `tokenReady` gates the <Outlet /> so pages don't fire API calls without auth.
  useEffect(() => {
    if (CLERK_ENABLED && session) {
      session.getToken().then((t) => { setClerkToken(t); setTokenReady(true); }).catch(() => { setClerkToken(null); setTokenReady(true); });
    } else {
      setTokenReady(true); // no Clerk → proceed immediately
    }
  }, [session]);

  // Auto-fetch farms on mount so every protected page has activeFarm populated
  // immediately — no more "No farm selected" on page refresh or direct navigation.
  useEffect(() => {
    if (farms.length === 0) {
      api.farms.list().then(setFarms).catch((err) =>
        console.warn('Failed to auto-fetch farms:', err?.response?.data?.error?.message ?? err.message)
      );
    }
  }, []);

  const handleLogout = () => {
    if (CLERK_ENABLED) {
      signOut?.();
    }
    clearAuth();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-parchment font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className={clsx('flex flex-col bg-forest-dark transition-all duration-200 shrink-0', collapsed ? 'w-16' : 'w-56')}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-5 border-b border-forest">
          <span className="text-2xl">🌿</span>
          {!collapsed && <span className="font-display text-white font-bold text-lg leading-tight">AgriSense</span>}
        </div>

        {/* Farm selector */}
        {!collapsed && activeFarm && (
          <div className="mx-3 mt-3 px-3 py-2 rounded-lg bg-forest text-white text-xs">
            <div className="text-sage-pale uppercase tracking-wider text-[10px] mb-0.5">Active Farm</div>
            <div className="font-semibold truncate">{activeFarm.name}</div>
            <div className="text-sage-pale">{activeFarm.total_area_ha} ha</div>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-amber text-forest-dark font-semibold'
                  : 'text-sage-pale hover:bg-forest hover:text-white'
              )}>
              <span className="text-base shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-forest p-3">
          {!collapsed && (
            <div className="mb-2">
              <div className="text-white text-xs font-semibold truncate">
                {CLERK_ENABLED ? clerkUser?.fullName ?? storeUser?.full_name : storeUser?.full_name}
              </div>
              <span className={clsx('text-[10px] px-2 py-0.5 rounded-full font-bold uppercase', TIER_COLORS[storeUser?.tier ?? 'FREE'])}>
                {storeUser?.tier ?? 'FREE'}
              </span>
            </div>
          )}
          <button onClick={handleLogout}
            className="w-full text-left text-sage-pale hover:text-white text-xs flex items-center gap-2 px-1">
            <span>🚪</span>{!collapsed && 'Sign out'}
          </button>
        </div>

        {/* Collapse toggle */}
        <button onClick={() => setCollapsed(!collapsed)}
          className="text-sage-pale hover:text-white text-xs pb-4 text-center">
          {collapsed ? '›' : '‹'}
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="h-14 bg-white border-b border-parchment-dark flex items-center px-6 gap-4 shrink-0">
          <div className="flex-1 flex items-center gap-3">
            {farms.length > 1 ? (
              <div className="flex items-center gap-2">
                <div className="relative">
                  <select
                    value={activeFarm?.id ?? ''}
                    onChange={(e) => {
                      const farm = farms.find(f => f.id === e.target.value);
                      if (farm) setActiveFarm(farm);
                    }}
                    className="appearance-none bg-parchment border border-parchment-dark rounded-lg pl-3 pr-8 py-1.5 text-sm text-forest font-semibold cursor-pointer hover:border-forest focus:outline-none focus:ring-2 focus:ring-forest transition-colors"
                  >
                    {!activeFarm && <option value="" disabled>Select a farm…</option>}
                    {farms.map(f => (
                      <option key={f.id} value={f.id}>{f.name} ({f.total_area_ha} ha)</option>
                    ))}
                  </select>
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sage text-xs pointer-events-none">▾</span>
                </div>
                {activeFarm && (
                  <Link to="/settings" className="text-[10px] text-sage hover:text-forest underline whitespace-nowrap">
                    Manage farms
                  </Link>
                )}
              </div>
            ) : activeFarm ? (
              <span className="text-forest text-sm font-semibold">{activeFarm.name}</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-dot" title="Live data" />
            <span className="text-xs text-sage">Live</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {tokenReady ? <Outlet /> : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="animate-spin text-4xl mb-3">🌿</div>
                <p className="text-sage text-sm">Loading…</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
