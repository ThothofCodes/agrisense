-- AgriSense Smart Farming System
-- Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
-- Author: Thoth of Codes
-- Licensed under the MIT License — see LICENSE file in the project root.

-- ============================================================================
-- Migration 004 — Clerk Authentication Integration
-- ============================================================================
-- Adds the columns and constraints needed for Clerk-authenticated users.
-- Key changes:
--   1. Adds clerk_id (VARCHAR, UNIQUE) so Clerk user IDs link to local user rows
--   2. Makes password_hash nullable — Clerk users authenticate via Clerk JWTs,
--      not local password verification. Legacy JWT users still need password_hash.
--   3. Adds an index on clerk_id for fast lookups from the webhook handler
-- ============================================================================

-- Add clerk_id column (nullable — legacy users won't have one)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255) UNIQUE;

-- Make password_hash nullable for Clerk-authenticated users who have no local password
ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

-- Index for fast lookups from the webhook handler
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);

-- Track which auth provider each user signed up through
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'legacy'
    CHECK (auth_provider IN ('clerk', 'legacy'));

COMMIT;
