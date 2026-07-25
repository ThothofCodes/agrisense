-- AgriSense Smart Farming System
-- Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
-- Author: Thoth of Codes
-- Licensed under the MIT License — see LICENSE file in the project root.

-- ============================================================================
-- Migration 003 — Quick Soil Check (UjuziKilimo competitive response)
-- ============================================================================
-- Context: FEASIBILITY_STUDY_GAP_ANALYSIS.md §1 confirmed UjuziKilimo (real,
-- 100,000+ Kenyan farmers, just launched SoilPal Pro Dec 2025) uses a
-- fundamentally different hardware approach — a handheld smartphone-connected
-- spectrometer — vs AgriSense's fixed IoT sensor nodes. That's a real
-- adoption-barrier gap: AgriSense currently has NO path to an SFS score
-- without first provisioning calibrated IoT hardware. This migration adds the
-- minimum schema needed for a manual/quick-entry pathway: any farmer can type
-- in readings from ANY source (a SoilPal, a county lab result, a test strip)
-- and get the same SFS computation and crop recommendation a sensor-fed farm
-- gets — clearly labelled as manually-entered, with a fixed, conservative
-- trust weighting rather than the IoT calibration-derived trust_score.
-- ============================================================================

CREATE TYPE sfs_source AS ENUM ('SENSOR', 'MANUAL');

ALTER TABLE soil_feasibility_scores
  ADD COLUMN IF NOT EXISTS source sfs_source NOT NULL DEFAULT 'SENSOR',
  ADD COLUMN IF NOT EXISTS entered_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS entry_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_sfs_farm_source ON soil_feasibility_scores(farm_id, source, computed_at DESC);

COMMIT;
