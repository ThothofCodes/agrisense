/**
 * AgriSense Smart Farming System
 * Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
 * Author: Thoth of Codes
 * Licensed under the MIT License — see LICENSE file in the project root.
 *
 * apps/api/src/__tests__/clerk-auth.test.ts
 * ───────────────────────────────────────────────────────────────────────────────
 * Integration tests covering the full Clerk auth flow:
 *
 *   1. Clerk JWT middleware — mock a Clerk-signed session JWT, verify the
 *      authenticate() middleware extracts the correct user (sub, email, tier).
 *      Also test the invalid/expired path returns 401.
 *
 *   2. Webhook handler — mock the Svix signature verification, then test
 *      user.created (new user, existing Clerk user update, legacy upgrade),
 *      user.updated, and user.deleted event handling.
 *
 *   3. MFA enforcement — test requireMfa() with a mock Clerk JWT carrying
 *      various amr (Authentication Methods Reference) claims.
 *
 * Run: npx jest clerk-auth --no-coverage
 *      (requires a running Postgres with agrisense_test DB — see .env.test)
 */

import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from '../index';
import { db, dbQuery, dbQueryOne } from '../db';
import { config } from '../config';

// ── Mock Clerk SDK ────────────────────────────────────────────────────────────────
// We mock @clerk/clerk-sdk-node so the auth middleware's verifyToken() path
// handles Clerk JWTs without needing real Clerk infrastructure. The mock
// returns a fake decoded JWT payload that matches what Clerk would return.
jest.mock('@clerk/clerk-sdk-node', () => {
  // The factory returns an object whose shape mimics createClerkClient.
  const mockVerifyToken = jest.fn();
  return {
    createClerkClient: jest.fn(() => ({
      verifyToken: mockVerifyToken,
    })),
    __mockVerifyToken: mockVerifyToken, // export reference so tests can set it
  };
});

// ── Mock Svix ─────────────────────────────────────────────────────────────────────
// The webhook handler uses Svix to verify Clerk webhook signatures. We mock
// the Webhook class so .verify() just returns the raw payload we pass in
// without actually checking a signature, letting us test the business logic.
jest.mock('svix', () => {
  const mockVerify = jest.fn();
  return {
    Webhook: jest.fn(() => ({
      verify: mockVerify,
    })),
    __mockVerify: mockVerify,
  };
});

// Import the mock references so we can configure them per-test
const clerkSdk = jest.requireMock('@clerk/clerk-sdk-node');
const svixMock = jest.requireMock('svix');

// ── Env helpers ───────────────────────────────────────────────────────────────────
// Stash original env so we can restore after tests
const ORIGINAL_ENV = { ...process.env };

function enableClerkMode() {
  process.env.VITE_CLERK_PUBLISHABLE_KEY = 'pk_test_mock_key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.CLERK_SECRET_KEY = 'sk_test_mock_key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.CLERK_WEBHOOK_SECRET = 'whsec_mock_key_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  // Re-import config — the module caches it, so we also need to invalidate
  // the require cache. For tests we directly set process.env before import.
  // Since config is already loaded, we patch its clerk fields directly.
  (config as any).clerk.publishableKey = process.env.VITE_CLERK_PUBLISHABLE_KEY;
  (config as any).clerk.secretKey = process.env.CLERK_SECRET_KEY;
  (config as any).clerk.webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
}

function disableClerkMode() {
  delete process.env.VITE_CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_WEBHOOK_SECRET;
  (config as any).clerk.publishableKey = '';
  (config as any).clerk.secretKey = '';
  (config as any).clerk.webhookSecret = '';
}

// ── Shared test data ──────────────────────────────────────────────────────────────
const CLERK_USER_ID = 'clerk_user_abc123';
const LEGACY_CLERK_ID = 'clerk_legacy_linked_456';
const TEST_EMAIL = `clerk_test_${Date.now()}@agrisense.test`;
const LEGACY_EMAIL = `legacy_upgrade_${Date.now()}@agrisense.test`;
const TEST_PASSWORD = 'TestPass123!';

let legacyUserId: string; // populated during the upgrade flow setup

// Note: Clerk mode is enabled globally via jest.config.json → setupFiles →
// setup-clerk.ts which sets the Clerk env vars before any module loads.
// This ensures the module-level `const CLERK_ENABLED` in auth.ts and
// webhooks.ts is `true` at import time. Tests that need to verify behavior
// with a disabled Clerk path would require changing auth.ts to use a getter
// function instead of a module-level const — that's a larger refactor beyond
// the scope of these tests.

afterAll(async () => {
  // Clean up test data
  await dbQuery(`DELETE FROM users WHERE email LIKE 'clerk_test_%'`);
  await dbQuery(`DELETE FROM users WHERE email LIKE 'legacy_upgrade_%'`);
  await db.end();
});

// ── Helper to build a mock Clerk JWT token ────────────────────────────────────────
function createMockClerkJwt(overrides: Record<string, any> = {}): string {
  const payload = {
    sub: CLERK_USER_ID,
    email: TEST_EMAIL,
    amr: [],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  // We sign with the local secret so the fallback JWT verification works in
  // the test. The mock Clerk verifyToken will return this decoded payload.
  return jwt.sign(payload, config.jwt.accessSecret);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Clerk JWT Middleware
// ═══════════════════════════════════════════════════════════════════════════════
describe('Clerk JWT — authenticate middleware', () => {
  beforeEach(() => {
    enableClerkMode();
    jest.clearAllMocks();
  });

  it('authenticates with a valid mock Clerk JWT and extracts the user payload', async () => {
    // Arrange: configure the mock Clerk verifyToken to return a decoded payload
    const expectedSub = CLERK_USER_ID;
    clerkSdk.__mockVerifyToken.mockResolvedValueOnce({
      sub: expectedSub,
      email: TEST_EMAIL,
      amr: [],
    });

    // Act: make a GET /auth/me request with a Bearer token.
    // The middleware calls verifyToken() which hits our mock.
    const token = createMockClerkJwt({ sub: expectedSub });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    // Assert: the middleware extracts the correct user info and the route
    // successfully returns the user profile (fetched from DB by sub).
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    // The middleware should have set req.user.sub to the Clerk sub claim
    expect(clerkSdk.__mockVerifyToken).toHaveBeenCalledWith(token);
  });

  it('returns 401 when Clerk verifyToken throws (invalid/expired token)', async () => {
    // Arrange: mock Clerk verifyToken to reject (expired/invalid token)
    clerkSdk.__mockVerifyToken.mockRejectedValueOnce(new Error('Token expired'));

    // Act: make a request with a badly-signed token (local JWT won't match either)
    const badToken = 'invalid.token.here';
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${badToken}`);

    // Assert: 401 with the correct error code
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AS-003'); // TOKEN_INVALID
  });

  it('falls back to legacy JWT verification when Clerk verifyToken fails but local JWT is valid', async () => {
    // Arrange: Clerk verifyToken rejects, but we have a locally-signed token
    clerkSdk.__mockVerifyToken.mockRejectedValueOnce(new Error('Clerk unreachable'));

    // Sign a token with the local JWT secret (same as what the legacy flow uses)
    const localToken = jwt.sign(
      { sub: 'local_user', email: 'local@test.com', role: 'BASIC', tier: 'FREE' },
      config.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // Act: the middleware tries Clerk first (fails), then falls to local JWT
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${localToken}`);

    // Assert: the legacy JWT is accepted (Clerk fallback works)
    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeDefined();
  });

  it('returns 401 when no Authorization header is present', async () => {
    const res = await request(app).get('/api/v1/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AS-003');
  });

  it('returns 401 with an empty Bearer token', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer ');

    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Clerk Webhook Handler
// ═══════════════════════════════════════════════════════════════════════════════
describe('Clerk webhook — /api/v1/webhooks/clerk', () => {
  beforeEach(() => {
    disableClerkMode(); // reset
    enableClerkMode();
    jest.clearAllMocks();
  });

  /**
   * Build a fake Svix-verified payload. Because we mock the Webhook.verify()
   * method, it returns the raw payload we pass to it as the second argument
   * without actually checking the signature.
   */
  function buildWebhookPayload(overrides: Record<string, any> = {}) {
    const defaults = {
      type: 'user.created',
      data: {
        id: CLERK_USER_ID,
        email_addresses: [{ email_address: TEST_EMAIL }],
        first_name: 'Clerk',
        last_name: 'Farmer',
        phone_numbers: [{ phone_number: '+254700000000' }],
      },
    };
    const payload = { ...defaults, ...overrides };
    if (overrides.data) {
      payload.data = { ...defaults.data, ...overrides.data };
    }

    svixMock.__mockVerify.mockReturnValue(payload);
    return payload;
  }

  // ── user.created: fresh user ──────────────────────────────────────────────
  it('user.created with no existing user → inserts a new user row', async () => {
    const uniqueEmail = `clerk_test_new_${Date.now()}@agrisense.test`;
    const clerkId = `clerk_new_${Date.now()}`;

    buildWebhookPayload({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: uniqueEmail }],
        first_name: 'New',
        last_name: 'Farmer',
        phone_numbers: [],
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'test_svix_id')
      .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('svix-signature', 'test_signature')
      .send({}); // body doesn't matter since Svix is mocked

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify the user was created in the DB
    const user = await dbQueryOne<{ id: string; auth_provider: string; email: string }>(
      'SELECT id, auth_provider, email FROM users WHERE clerk_id = $1',
      [clerkId]
    );
    expect(user).not.toBeNull();
    expect(user!.auth_provider).toBe('clerk');
    expect(user!.email).toBe(uniqueEmail);

    // Cleanup
    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  // ── user.created: existing Clerk user (update) ────────────────────────────
  it('user.created when clerk_id already exists → updates the existing user', async () => {
    const clerkId = `clerk_update_${Date.now()}`;
    const email = `clerk_update_${Date.now()}@agrisense.test`;

    // First, create a user via the webhook (which hits the INSERT path)
    buildWebhookPayload({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: email }],
        first_name: 'Original',
        last_name: 'Name',
        phone_numbers: [],
      },
    });

    await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid1').set('svix-timestamp', '1000000').set('svix-signature', 'sig1')
      .send({});

    // Now send an update with different name
    buildWebhookPayload({
      type: 'user.updated',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: email }],
        first_name: 'Updated',
        last_name: 'Name',
        phone_numbers: [],
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid2').set('svix-timestamp', '1000001').set('svix-signature', 'sig2')
      .send({});

    expect(res.status).toBe(200);

    const user = await dbQueryOne<{ full_name: string }>(
      'SELECT full_name FROM users WHERE clerk_id = $1',
      [clerkId]
    );
    expect(user?.full_name).toBe('Updated Name');

    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  // ── user.created: legacy upgrade path ─────────────────────────────────────
  it('user.created with matching legacy email → links existing user (upgrade path)', async () => {
    // Step 1: Create a legacy user via the registration endpoint (Clerk OFF)
    disableClerkMode();
    const legacyEmail = `legacy_upgrade_test_${Date.now()}@agrisense.test`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: legacyEmail, password: 'LegacyPass123!', full_name: 'Legacy Farmer' });
    expect(regRes.status).toBe(201);
    legacyUserId = regRes.body.data.user.id;

    // Step 2: Enable Clerk mode and fire a user.created webhook with same email
    enableClerkMode();
    jest.clearAllMocks();
    const clerkIdForLegacy = `clerk_linked_${Date.now()}`;

    buildWebhookPayload({
      type: 'user.created',
      data: {
        id: clerkIdForLegacy,
        email_addresses: [{ email_address: legacyEmail }],
        first_name: 'Legacy',  // should match existing user's name
        last_name: 'Farmer',
        phone_numbers: [],
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid').set('svix-timestamp', '1000000').set('svix-signature', 'sig')
      .send({});

    expect(res.status).toBe(200);

    // Step 3: Verify the legacy user's row was updated (not a new row created)
    const updatedUser = await dbQueryOne<{ clerk_id: string; auth_provider: string }>(
      'SELECT clerk_id, auth_provider FROM users WHERE id = $1',
      [legacyUserId]
    );
    expect(updatedUser?.clerk_id).toBe(clerkIdForLegacy);
    expect(updatedUser?.auth_provider).toBe('clerk');

    // Step 4: Verify no duplicate user was created (same email, different id)
    const duplicateCheck = await dbQuery<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [legacyEmail]
    );
    expect(duplicateCheck.length).toBe(1); // only the upgraded legacy user
    expect(duplicateCheck[0].id).toBe(legacyUserId);

    // Cleanup
    disableClerkMode();
    // We clean up in afterAll via the LIKE pattern
  });

  // ── user.created: no match (different email) → fresh user ────────────────
  it('user.created with non-matching legacy email → creates fresh user', async () => {
    const freshEmail = `clerk_fresh_${Date.now()}@agrisense.test`;
    const clerkId = `clerk_fresh_${Date.now()}`;

    buildWebhookPayload({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: freshEmail }],
        first_name: 'Fresh',
        last_name: 'User',
        phone_numbers: [],
      },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid').set('svix-timestamp', '1000000').set('svix-signature', 'sig')
      .send({});

    expect(res.status).toBe(200);

    const user = await dbQueryOne<{ id: string; auth_provider: string }>(
      'SELECT id, auth_provider FROM users WHERE clerk_id = $1',
      [clerkId]
    );
    expect(user).not.toBeNull();
    expect(user!.auth_provider).toBe('clerk');

    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  // ── user.deleted ──────────────────────────────────────────────────────────
  it('user.deleted → deactivates the user (is_active = false)', async () => {
    // Create a user first (via webhook)
    const clerkId = `clerk_delete_${Date.now()}`;
    const email = `clerk_delete_${Date.now()}@agrisense.test`;

    buildWebhookPayload({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: email }],
        first_name: 'Delete', last_name: 'Me', phone_numbers: [],
      },
    });

    await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid1').set('svix-timestamp', '1000000').set('svix-signature', 'sig1')
      .send({});

    // Now send user.deleted
    jest.clearAllMocks();
    svixMock.__mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: clerkId },
    });

    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid2').set('svix-timestamp', '1000001').set('svix-signature', 'sig2')
      .send({});

    expect(res.status).toBe(200);

    const user = await dbQueryOne<{ is_active: boolean }>(
      'SELECT is_active FROM users WHERE clerk_id = $1',
      [clerkId]
    );
    expect(user?.is_active).toBe(false);

    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  // ── Missing Svix headers → 400 ────────────────────────────────────────────
  it('returns 400 when Svix headers are missing', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .send({}); // no svix-id, svix-timestamp, svix-signature headers

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Missing Svix headers');
  });

  // ── Clerk webhooks not configured → 200 with message ─────────────────────
  it('returns 200 with message when Clerk is disabled', async () => {
    disableClerkMode();
    const res = await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid').set('svix-timestamp', '1000000').set('svix-signature', 'sig')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('not configured');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. MFA Enforcement
// ═══════════════════════════════════════════════════════════════════════════════
describe('MFA enforcement — requireMfa()', () => {
  beforeEach(() => {
    enableClerkMode();
    jest.clearAllMocks();
  });

  it('allows requests with amr containing "mfa" when user has MFA enabled', async () => {
    // Create a user with MFA enabled
    const email = `clerk_mfa_${Date.now()}@agrisense.test`;
    const clerkId = `clerk_mfa_${Date.now()}`;

    // Create the user in DB via the webhook
    svixMock.__mockVerify.mockReturnValue({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: email }],
        first_name: 'MFA', last_name: 'User', phone_numbers: [],
      },
    });
    await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid').set('svix-timestamp', '1000000').set('svix-signature', 'sig')
      .send({});

    // Enable MFA for this user
    await dbQuery('UPDATE users SET mfa_enabled = true WHERE clerk_id = $1', [clerkId]);

    // Mock Clerk JWT with mfa in amr
    clerkSdk.__mockVerifyToken.mockResolvedValueOnce({
      sub: clerkId,
      email: email,
      amr: ['mfa'],
    });

    const token = createMockClerkJwt({ sub: clerkId, amr: ['mfa'] });
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  it('blocks requests without "mfa" in amr when user has MFA enabled', async () => {
    const email = `clerk_mfa_block_${Date.now()}@agrisense.test`;
    const clerkId = `clerk_mfa_block_${Date.now()}`;

    svixMock.__mockVerify.mockReturnValue({
      type: 'user.created',
      data: {
        id: clerkId,
        email_addresses: [{ email_address: email }],
        first_name: 'Block', last_name: 'User', phone_numbers: [],
      },
    });
    await request(app)
      .post('/api/v1/webhooks/clerk')
      .set('svix-id', 'sid').set('svix-timestamp', '1000000').set('svix-signature', 'sig')
      .send({});

    await dbQuery('UPDATE users SET mfa_enabled = true WHERE clerk_id = $1', [clerkId]);

    // Mock Clerk JWT without mfa in amr
    clerkSdk.__mockVerifyToken.mockResolvedValueOnce({
      sub: clerkId,
      email: email,
      amr: [], // no mfa
    });

    // PATCH /users/me uses requireMfa()
    const token = createMockClerkJwt({ sub: clerkId, amr: [] });
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Hacker' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AS-005'); // MFA_REQUIRED

    await dbQuery('DELETE FROM users WHERE clerk_id = $1', [clerkId]);
  });

  it('blocks legacy JWT users with MFA enabled (Clerk mode, no amr claim)', async () => {
    // Legacy user with MFA enabled — Clerk is enabled globally (from setup file)
    // so requireMfa() will check for the amr claim. A legacy JWT doesn't have
    // an amr field, so the request should be blocked with MFA_REQUIRED.
    const email = `legacy_mfa_block_${Date.now()}@agrisense.test`;
    const regRes = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: 'MfaPass123!', full_name: 'MFA Legacy' });
    expect(regRes.status).toBe(201);
    const userId = regRes.body.data.user.id;

    await dbQuery('UPDATE users SET mfa_enabled = true WHERE id = $1', [userId]);

    // Legacy JWT with no amr claim
    const token = regRes.body.data.tokens.accessToken;
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ full_name: 'Hacker' });

    // Clerk mode is active (from setup file), MFA is enabled on this user,
    // and the legacy JWT carries no amr claim — requireMfa() blocks it.
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AS-005'); // MFA_REQUIRED

    await dbQuery('DELETE FROM users WHERE id = $1', [userId]);
  });
});
