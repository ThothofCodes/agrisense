/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 *
 * Jest setup file — runs BEFORE any test file is imported.
 *
 * Sets Clerk environment variables so that auth.ts and webhooks.ts compute
 * CLERK_ENABLED = true at import time. Without this, the module-level `const
 * CLERK_ENABLED = !!(config.clerk.secretKey && config.clerk.publishableKey)`
 * evaluates to false and the Clerk code path is never entered — all Clerk JWT
 * tests would silently test the legacy fallback instead.
 *
 * Individual tests can still disable Clerk mode at runtime by calling
 * disableClerkMode() which patches config.clerk.*. The module-level constant
 * is already set, but the middleware functions check it at invocation time.
 */

process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_setup_default_key_for_tests';
process.env.CLERK_SECRET_KEY = 'sk_test_setup_default_key_for_tests';
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_setup_default_key_for_tests';
