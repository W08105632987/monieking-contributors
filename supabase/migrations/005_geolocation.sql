-- ================================================================
-- MonieKing Contributors — Customer Base Geography
-- Migration: 005_geolocation.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–004.
--
-- Adds an optional, consent-based location capture, asked once right
-- after registration (with a Skip option), so Directors can see which
-- states their customer base is concentrated in. Aggregated only — no
-- per-customer location is ever shown in the UI, just counts by state.
-- ================================================================

CREATE TYPE location_consent_status AS ENUM ('not_asked', 'granted', 'declined');

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS location_consent_status location_consent_status NOT NULL DEFAULT 'not_asked',
  ADD COLUMN IF NOT EXISTS location_latitude  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS detected_state      TEXT;

CREATE INDEX IF NOT EXISTS idx_users_detected_state ON users(detected_state);
