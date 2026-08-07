-- ================================================================
-- MonieKing Contributors
-- Migration: 012_zone_coverage.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–011.
--
-- Implements zone-based officer coverage: a zone has exactly one
-- officer at a time, customers belong to a zone (not a specific
-- officer), and "who can manage this customer" is resolved as "whoever
-- currently covers their zone" — not the permanent managing_officer_id
-- link, which stays purely as a historical "who originally registered
-- them" record.
--
-- zone_assignments is a pure audit log: users.zone_id remains the fast,
-- authoritative "current zone" for every authorization check (no join
-- needed on the hot path). A row here with ended_at IS NULL is that
-- officer's currently-active assignment.
-- ================================================================

CREATE TABLE IF NOT EXISTS zone_assignments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SET NULL, not CASCADE — deleting a zone must never destroy the
  -- historical record of who covered it and when. zone_name is a
  -- snapshot taken at assignment time so history stays readable even
  -- after the zone itself is later deleted or renamed.
  zone_id                   UUID REFERENCES zones(id) ON DELETE SET NULL,
  zone_name                 VARCHAR(100) NOT NULL,
  officer_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by_director_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_zone_assignments_officer ON zone_assignments(officer_id);
CREATE INDEX IF NOT EXISTS idx_zone_assignments_zone    ON zone_assignments(zone_id);

-- Only one ACTIVE (ended_at IS NULL) assignment per officer, and only
-- one per zone, at the database level — a backstop against a race
-- creating two simultaneous "current" assignments, same defensive
-- pattern already used for pending rate changes in an earlier migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_assignments_one_active_per_officer
  ON zone_assignments(officer_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_zone_assignments_one_active_per_zone
  ON zone_assignments(zone_id) WHERE ended_at IS NULL;

-- Backfill: every officer who currently has a zone_id gets an initial
-- history row representing their existing assignment, so coverage
-- history isn't empty from day one of this feature.
INSERT INTO zone_assignments (zone_id, zone_name, officer_id, started_at, ended_at)
SELECT u.zone_id, z.name, u.id, u.created_at, NULL
FROM users u
JOIN zones z ON z.id = u.zone_id
WHERE u.role = 'officer' AND u.zone_id IS NOT NULL;

-- Backfill: every existing customer inherits their zone from their
-- current managing_officer's zone — this preserves exactly who can see
-- each customer today, rather than the switch to zone-based access
-- abruptly hiding everyone's existing customers.
UPDATE users c
SET zone_id = o.zone_id
FROM users o
WHERE c.role = 'customer'
  AND c.managing_officer_id = o.id
  AND o.zone_id IS NOT NULL
  AND c.zone_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_zone_id_role ON users(zone_id, role);
