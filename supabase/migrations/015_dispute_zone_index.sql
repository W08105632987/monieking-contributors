-- ================================================================
-- MonieKing Contributors
-- Migration: 015_dispute_zone_index.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–014.
--
-- The dispute-authorization rewrite (zone-based officer access,
-- matching how cards already work) added a new query shape:
-- `WHERE zone_id = ? AND status != 'escalated'`, run on every officer
-- dispute-list load and every view/reply/resolve permission check.
-- zone_id had no index at all before this — everything else on
-- disputes did (raised_by, assigned_to, status), this one just never
-- existed as a filter until now.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_disputes_zone_status
  ON disputes(zone_id, status);
