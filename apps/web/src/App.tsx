/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';
import AppLayout from './components/layout/AppLayout';
import DashboardPage from './pages/Dashboard';
import { LandingPage, SoilPage, WeatherPage, AdvisorPage, AlertsPage, LoginPage, RegisterPage, CalendarPage, SensorsPage, CropsPage, FieldMapPage, SettingsPage } from './pages/Pages';
import { TreatmentsPage, DiagnosesPage, SharesPage } from './pages/V3Pages';
import { useAuthStore } from './store';

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // When Clerk is configured, use Clerk's auth check; otherwise fall back to
  // the existing JWT-based useAuthStore for backward compatibility.
  if (CLERK_ENABLED) {
    const { isSignedIn } = useAuth();
    if (isSignedIn === undefined) return null; // loading
    if (!isSignedIn) return <Navigate to="/login" replace />;
    return <>{children}</>;
  }

  const { isAuthenticated } = useAuthStore();
  return isAuthenticated() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="dashboard"  element={<DashboardPage />} />
            <Route path="soil"       element={<SoilPage />} />
            <Route path="weather"    element={<WeatherPage />} />
            <Route path="advisor"    element={<AdvisorPage />} />
            <Route path="alerts"     element={<AlertsPage />} />
            <Route path="calendar"   element={<CalendarPage />} />
            <Route path="treatments" element={<TreatmentsPage />} />
            <Route path="diagnoses"  element={<DiagnosesPage />} />
            <Route path="shares"     element={<SharesPage />} />
            <Route path="crops"      element={<CropsPage />} />
            <Route path="field-map"  element={<FieldMapPage />} />
            <Route path="sensors"    element={<SensorsPage />} />
            <Route path="settings"   element={<SettingsPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
