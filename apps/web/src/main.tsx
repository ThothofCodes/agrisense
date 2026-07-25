/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import App from './App';
import './index.css';

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// If Clerk is not configured, render the app without ClerkProvider
// so the existing JWT auth flow still works during development.
const Root = CLERK_PUBLISHABLE_KEY ? (
  <ClerkProvider
    publishableKey={CLERK_PUBLISHABLE_KEY}
    // ── OAuth & Social Login redirects ────────────────────────────────────────
    // After a successful sign-in (via social provider or email/password), the
    // user is sent to the dashboard. After sign-up, same destination.
    // `signInUrl` tells Clerk where to redirect users that land on a protected
    // page without being authenticated.
    afterSignInUrl="/dashboard"
    afterSignUpUrl="/dashboard"
    signInUrl="/login"
  >
    <App />
  </ClerkProvider>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {Root}
  </React.StrictMode>
);
