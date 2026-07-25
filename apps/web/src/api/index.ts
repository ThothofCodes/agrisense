/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import axios from 'axios';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001/api/v1',
  withCredentials: true,
  timeout: 15000,
});

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// ── Auth token helper ───────────────────────────────────────────────────────────
// When Clerk is active, the interceptor below calls Clerk's getToken() to get a
// short-lived session JWT. When Clerk is off, it reads the legacy JWT from
// localStorage. Both flows attach the result as `Authorization: Bearer <token>`.
let _clerkToken: string | null = null;

/** Store a fresh Clerk session token — called by the Clerk auth sync effect. */
export function setClerkToken(token: string | null) {
  _clerkToken = token;
}

// Attach JWT from Clerk (when available) or from localStorage (legacy fallback)
apiClient.interceptors.request.use(async (cfg) => {
  if (CLERK_ENABLED) {
    if (_clerkToken) {
      cfg.headers.Authorization = `Bearer ${_clerkToken}`;
    }
    // If _clerkToken is null, the request will likely 401 — the caller should
    // handle that by redirecting to /login.
  } else {
    const token = localStorage.getItem('access_token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

// Auto-refresh on 401 (legacy JWT flow only — Clerk handles its own refresh)
apiClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config;
    if (CLERK_ENABLED) return Promise.reject(err); // Clerk handles its own refresh

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = localStorage.getItem('refresh_token');
        const { data } = await axios.post(
          `${import.meta.env.VITE_API_URL}/auth/refresh`,
          { refreshToken }
        );
        localStorage.setItem('access_token', data.data.tokens.accessToken);
        original.headers.Authorization = `Bearer ${data.data.tokens.accessToken}`;
        return apiClient(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  }
);

// ── Typed API functions (unchanged) ─────────────────────────────────────────────
export const api = {
  auth: {
    login:    (email: string, password: string) =>
      apiClient.post('/auth/login', { email, password }).then(r => r.data.data),
    register: (payload: any) =>
      apiClient.post('/auth/register', payload).then(r => r.data.data),
    me:       () => apiClient.get('/auth/me').then(r => r.data.data.user),
    logout:   () => apiClient.post('/auth/logout'),
  },
  farms: {
    list:    () => apiClient.get('/farms').then(r => r.data.data.farms),
    get:     (id: string) => apiClient.get(`/farms/${id}`).then(r => r.data.data.farm),
    create:  (payload: any) => apiClient.post('/farms', payload).then(r => r.data.data.farm),
    update:  (id: string, payload: any) => apiClient.patch(`/farms/${id}`, payload),
    summary: (id: string) => apiClient.get(`/farms/${id}/summary`).then(r => r.data.data),
  },
  sensors: {
    list:    (farmId: string) => apiClient.get('/sensors', { params: { farm_id: farmId } }).then(r => r.data.data.nodes),
    latest:  (nodeId: string) => apiClient.get(`/sensors/${nodeId}/latest`).then(r => r.data.data.readings),
    readings:(nodeId: string, params?: any) =>
      apiClient.get(`/sensors/${nodeId}/readings`, { params }).then(r => r.data.data.readings),
    register:(payload: any) => apiClient.post('/sensors/register', payload).then(r => r.data.data.node),
  },
  weather: {
    current:  (farmId: string) => apiClient.get(`/weather/${farmId}/current`).then(r => r.data.data.weather),
    forecast: (farmId: string, days = 7) => apiClient.get(`/weather/${farmId}/forecast`, { params: { days } }).then(r => r.data.data.forecast),
    history:  (farmId: string, days = 30) => apiClient.get(`/weather/${farmId}/history`, { params: { days } }).then(r => r.data.data.history),
  },
  crops: {
    list:     () => apiClient.get('/crops').then(r => r.data.data.crops),
    calendar: (zone = 'EAF') => apiClient.get(`/crops/calendar/${zone}`).then(r => r.data.data.calendar),
  },
  cycles: {
    list:   (farmId: string) => apiClient.get('/cycles', { params: { farm_id: farmId } }).then(r => r.data.data.cycles),
    create: (payload: any) => apiClient.post('/cycles', payload).then(r => r.data.data.cycle),
    gdd:    (cycleId: string) => apiClient.get(`/cycles/${cycleId}/gdd`).then(r => r.data.data),
  },
  alerts: {
    list:        (farmId: string, status?: string) =>
      apiClient.get('/alerts', { params: { farm_id: farmId, status } }).then(r => r.data.data.alerts),
    acknowledge: (id: string) => apiClient.patch(`/alerts/${id}/acknowledge`),
    dismiss:     (id: string) => apiClient.patch(`/alerts/${id}/dismiss`),
  },
  sfs:  {
    get: (farmId: string) => apiClient.get(`/sfs/${farmId}`).then(r => r.data.data),
    submitManual: (farmId: string, payload: any) =>
      apiClient.post(`/sfs/${farmId}/manual`, payload).then(r => r.data.data),
  },
  recommendations: {
    crops:   (payload: any) =>
      apiClient.post('/recommendations/crops', payload).then(r => r.data.data),
    history: (farmId: string) =>
      apiClient.get(`/recommendations/crops/history/${farmId}`).then(r => r.data.data.history),
  },
  payments: {
    subscribe: (tier: string, phone: string) =>
      apiClient.post('/payments/subscribe', { tier, phone }).then(r => r.data.data),
  },
  treatments: {
    list:     (farmId: string) => apiClient.get('/treatments', { params: { farm_id: farmId } }).then(r => r.data.data.treatments),
    create:   (payload: any) => apiClient.post('/treatments', payload).then(r => r.data.data.treatment),
    phiCheck: (cropCycleId: string) => apiClient.get(`/treatments/phi-check/${cropCycleId}`).then(r => r.data.data),
  },
  diagnoses: {
    list:   (farmId: string) => apiClient.get('/diagnoses', { params: { farm_id: farmId } }).then(r => r.data.data.diagnoses),
    create: (payload: any) => apiClient.post('/diagnoses', payload).then(r => r.data.data),
    review: (id: string, payload: any) => apiClient.patch(`/diagnoses/${id}/review`, payload).then(r => r.data.data.diagnosis),
  },
  shares: {
    list:   (farmId: string) => apiClient.get('/shares', { params: { farm_id: farmId } }).then(r => r.data.data.shares),
    create: (farmId: string, role: string) => apiClient.post('/shares', { farm_id: farmId, role }).then(r => r.data.data),
    revoke: (id: string) => apiClient.patch(`/shares/${id}/revoke`),
  },
};
