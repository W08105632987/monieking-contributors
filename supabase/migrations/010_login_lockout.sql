-- ================================================================
-- MonieKing Contributors
-- Migration: 010_login_lockout.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–009.
--
-- Adds server-enforced escalating login lockout, mirroring the
-- existing withdrawal_password_failed_attempts / _locked_until
-- pattern already on this table — same idea, applied to login.
--
-- login_lockout_level tracks how many times this account has been
-- locked before: 0 = never locked (or reset after a clean login),
-- so the NEXT lockout (on the 5th consecutive failure) is 1 hour.
-- Once level >= 1, the next lockout after that is 3 hours, and stays
-- at 3 hours for any repeat after that.
-- ================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS login_locked_until     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS login_lockout_level    INTEGER NOT NULL DEFAULT 0;
