-- 021_schema_drift_reconciliation.sql
-- Fixes BUG MK-SCHEMA-001 (six confirmed model/migration drift points).
--
-- IMPORTANT — READ BEFORE RUNNING AGAINST PRODUCTION:
-- The audit that found these was run against a from-scratch sandbox DB
-- built ONLY from this repo's shipped migrations, never against the
-- real Supabase project. That means two things can be true at once:
--   1. If your real production schema was built by running 001→020 in
--      order, it has literally the same gaps documented below (that's
--      exactly what the sandbox reproduced), and this migration is
--      exactly what it needs.
--   2. If production's schema was ever hand-patched, or built some
--      other way, its actual current shape is unknown to this migration.
-- Every statement below is written to be idempotent and additive
-- (IF NOT EXISTS / conditional guards throughout) specifically so it's
-- safe to run either way — nothing here drops or overwrites existing
-- data — but you should still run this against a staging copy of the
-- real database first, per the audit's own recommendation, rather than
-- trusting this comment in place of that check.

-- ── 1. users.bank_code — model requires it, no migration ever added it.
-- Reproduced live: POST /auth/register and GET /users/me both 500 with
-- "column users.bank_code does not exist" without this. ──────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS bank_code TEXT;

-- ── 2. contribution_records.is_withdrawn — the single field the entire
-- withdrawal-consumption/reversal logic depends on (004's own comment
-- describes records being "marked is_withdrawn=true" as if the column
-- already existed — it never did). Defaults false so every existing
-- row reads as "not yet withdrawn", which is the correct backfill: a
-- withdrawal that actually completed against this schema couldn't have
-- worked at all without this column, so there's no historical
-- "already withdrawn" state to reconstruct. ──────────────────────────
ALTER TABLE contribution_records
  ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN NOT NULL DEFAULT false;

-- ── 3. withdrawals.source — model requires a withdrawal_source enum
-- column distinguishing card-withdrawals from instant wallet
-- withdrawals; no migration ever created the type or the column. ─────
DO $$ BEGIN
  CREATE TYPE withdrawal_source AS ENUM ('card', 'wallet');
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- already created by a prior partial run
END $$;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS source withdrawal_source NOT NULL DEFAULT 'card';
-- Default 'card' as the backfill for existing rows is deliberate: this
-- table predates wallet-sourced withdrawals in every migration prior to
-- this one (see item 4 below — card_id was NOT NULL until now, which
-- only a card-sourced withdrawal could have satisfied), so every
-- existing row is safely a card withdrawal by construction.

-- ── 4. withdrawals.card_id nullability — model requires nullable (a
-- wallet-sourced withdrawal has no card), DB has it NOT NULL. Without
-- this fix, every wallet-sourced withdrawal fails before it can even
-- reach the app's business logic. ─────────────────────────────────────
ALTER TABLE withdrawals
  ALTER COLUMN card_id DROP NOT NULL;

-- ── 5. dispute_messages.read_at — model requires it for read-receipt
-- tracking, migration 013 never added it. ─────────────────────────────
ALTER TABLE dispute_messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- ── 6. webauthn_credentials — the messiest one. 001_initial_schema.sql
-- created this table with `device_name TEXT` and TEXT-typed
-- credential_id/public_key. 006_v6_features.sql later tried to
-- `CREATE TABLE webauthn_credentials` again from scratch with the
-- model's real shape (`nickname`, BYTEA-typed credential_id/public_key,
-- sign_count, last_used_at) — which, on any database where 001 already
-- ran, fails outright with "relation already exists" rather than
-- silently no-opping, since it has no IF NOT EXISTS guard. That means
-- 006 either (a) never actually succeeded against your real database,
-- leaving it on 001's shape, or (b) somehow ran against a database
-- where the table didn't yet exist. This block handles case (a) —
-- reconciling 001's shape into the model's expected shape — and is a
-- safe no-op if you're already on the correct shape.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webauthn_credentials' AND column_name = 'device_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webauthn_credentials' AND column_name = 'nickname'
  ) THEN
    ALTER TABLE webauthn_credentials RENAME COLUMN device_name TO nickname;
    ALTER TABLE webauthn_credentials ALTER COLUMN nickname SET DEFAULT 'Biometric login';
    ALTER TABLE webauthn_credentials ALTER COLUMN nickname SET NOT NULL;
  END IF;

  -- credential_id/public_key type (TEXT in 001's shape vs BYTEA the
  -- model expects) is deliberately NOT auto-converted here. If any
  -- rows already exist, blindly casting TEXT to BYTEA risks corrupting
  -- real registered credentials depending on how they were encoded —
  -- that decision needs a human who can inspect actual row contents
  -- first, not a migration guessing. This only auto-converts when the
  -- table is empty (nothing to lose), which is the expected state
  -- anyway per the audit: the WebAuthn ceremony couldn't be exercised
  -- end-to-end without a real Supabase Auth server, so no real
  -- credentials are expected to exist yet.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'webauthn_credentials' AND column_name = 'credential_id' AND data_type = 'text'
  ) THEN
    IF (SELECT count(*) FROM webauthn_credentials) = 0 THEN
      ALTER TABLE webauthn_credentials ALTER COLUMN credential_id TYPE BYTEA USING credential_id::bytea;
      ALTER TABLE webauthn_credentials ALTER COLUMN public_key    TYPE BYTEA USING public_key::bytea;
    ELSE
      RAISE NOTICE 'webauthn_credentials has existing rows with TEXT credential_id/public_key — NOT auto-converted to BYTEA. Needs a manual, inspected data migration before WebAuthn login will work correctly for those rows.';
    END IF;
  END IF;
END $$;
