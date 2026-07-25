/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 *
 * apps/web/src/__tests__/ProtectedRoute.test.tsx
 * ───────────────────────────────────────────────────────────────────────────────
 * Tests for the ProtectedRoute component which gates authenticated pages.
 *
 * Key scenarios:
 *   1. Clerk mode — unauthenticated user → redirect to /login
 *   2. Clerk mode — authenticated user → renders children
 *   3. Clerk mode — loading state (isSignedIn === undefined) → renders null
 *   4. Legacy mode — unauthenticated user → redirect to /login
 *   5. Legacy mode — authenticated user → renders children
 *
 * Run: npx vitest run ProtectedRoute
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ── Mock Clerk ─────────────────────────────────────────────────────────────────
vi.mock('@clerk/clerk-react', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@clerk/clerk-react';
import { ProtectedRoute } from '../App';

// ── Mock the legacy auth store ─────────────────────────────────────────────────
vi.mock('../store', () => ({
  useAuthStore: vi.fn(),
}));

import { useAuthStore } from '../store';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockUseAuth = vi.mocked(useAuth);
const mockUseAuthStore = vi.mocked(useAuthStore);

// ── Helper wrapper ─────────────────────────────────────────────────────────────
const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });

function renderWithRouter(ui: React.ReactElement, initialEntries = ['/']) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        {ui}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ProtectedRoute — Clerk mode
// ═══════════════════════════════════════════════════════════════════════════════
describe('ProtectedRoute — Clerk mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Enable Clerk mode via vitest's env stub
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_mock_key');
  });

  it('redirects to /login when user is not signed in', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: false,
      isLoaded: true,
      userId: null,
      sessionId: null,
      signOut: vi.fn(),
      getToken: vi.fn(),
    } as any);

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>,
      ['/dashboard']
    );

    // The ProtectedRoute should redirect to /login which renders nothing here
    // (since we didn't set up a /login route). Instead, we verify the protected
    // content is NOT rendered.
    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders children when user is signed in', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: true,
      isLoaded: true,
      userId: 'user_test_123',
      sessionId: 'session_test_123',
      signOut: vi.fn(),
      getToken: vi.fn(),
    } as any);

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>,
      ['/dashboard']
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });

  it('renders nothing (null) while auth state is loading', () => {
    mockUseAuth.mockReturnValue({
      isSignedIn: undefined, // loading state
      isLoaded: false,
      userId: null,
      sessionId: null,
      signOut: vi.fn(),
      getToken: vi.fn(),
    } as any);

    const { container } = renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>,
      ['/dashboard']
    );

    // The container should be empty (ProtectedRoute returns null while loading)
    expect(container.innerHTML).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ProtectedRoute — Legacy JWT mode
// ═══════════════════════════════════════════════════════════════════════════════
describe('ProtectedRoute — legacy JWT mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Disable Clerk mode by making the env var empty
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', '');
  });

  it('redirects to /login when not authenticated (legacy mode)', () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: () => false,
      user: null,
      accessToken: null,
    } as any);

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>,
      ['/dashboard']
    );

    expect(screen.queryByText('Protected Content')).toBeNull();
  });

  it('renders children when authenticated (legacy mode)', () => {
    mockUseAuthStore.mockReturnValue({
      isAuthenticated: () => true,
      user: { id: 'legacy', email: 'farmer@test.com', full_name: 'Test Farmer', role: 'BASIC', tier: 'FREE' },
      accessToken: 'fake_token',
    } as any);

    renderWithRouter(
      <ProtectedRoute><div>Protected Content</div></ProtectedRoute>,
      ['/dashboard']
    );

    expect(screen.getByText('Protected Content')).toBeDefined();
  });
});
