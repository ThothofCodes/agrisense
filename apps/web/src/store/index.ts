/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User { id: string; email: string; full_name: string; role: string; tier: string; }
interface Farm {
  id: string; name: string; latitude: number; longitude: number;
  total_area_ha: number; season_zone: string;
  county?: string; country?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  setAuth: (user: User, tokens: { accessToken: string; refreshToken: string }) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

interface FarmState {
  activeFarm: Farm | null;
  farms: Farm[];
  setActiveFarm: (farm: Farm) => void;
  setFarms: (farms: Farm[]) => void;
  clearFarms: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, tokens) => {
        localStorage.setItem('access_token', tokens.accessToken);
        localStorage.setItem('refresh_token', tokens.refreshToken);
        set({ user, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      },
      clearAuth: () => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('agrisense-farms');
        set({ user: null, accessToken: null, refreshToken: null });
      },
      isAuthenticated: () => !!get().user && !!get().accessToken,
    }),
    {
      name: 'agrisense-auth',
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    }
  )
);

export const useFarmStore = create<FarmState>()(
  persist(
    (set) => ({
      activeFarm: null,
      farms: [],
      setActiveFarm: (farm) => set({ activeFarm: farm }),
      setFarms: (farms) => set({ farms, activeFarm: farms[0] ?? null }),
      clearFarms: () => set({ activeFarm: null, farms: [] }),
    }),
    {
      name: 'agrisense-farms',
      partialize: (s) => ({
        activeFarm: s.activeFarm,
        farms: s.farms,
      }),
    }
  )
);
