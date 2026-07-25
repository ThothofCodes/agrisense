-- AgriSense Smart Farming System
-- Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
-- Licensed under the MIT License — see LICENSE file in the project root.

-- ============================================================================
-- Migration 004 — Clerk Authentication Support
-- ============================================================================
-- Adds a `clerk_id` column to the users table so Clerk-authenticated users
-- can be linked to their local DB record. The column is nullable because
-- existing users (created via the legacy email/password flow) won't have one.
-- A unique index ensures no two Clerk users map to the same local account.
-- ============================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255) UNIQUE;

CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id);

COMMIT;
