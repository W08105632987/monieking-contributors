-- 025_bill_payments_schema_reconciliation.sql
--
-- Confirmed root cause: `billers` already existed in this database
-- (from something other than 019_bill_payments.sql — possibly a manual
-- Supabase Table Editor creation, or a partial hand-run of an earlier
-- draft of that file) BEFORE 019 ever ran. CREATE TABLE fails as a
-- whole statement the instant the table already exists — it doesn't
-- add whatever columns are missing, it just errors — so 019's
-- `billers` definition (including price_kobo) was never actually
-- applied. Worse: most SQL runners (Supabase's SQL editor included)
-- stop at the first error in a multi-statement script, so everything
-- AFTER that failed CREATE TABLE in 019 — including
-- `CREATE TABLE bill_payment_requests` — may never have run either.
--
-- This migration is written to be correct regardless of which of those
-- actually happened: every ADD COLUMN is IF NOT EXISTS (safe whether
-- the column is already there or not), bill_payment_requests uses
-- CREATE TABLE IF NOT EXISTS with its full definition (safe whether it
-- exists already or needs creating from scratch), and both enum types
-- are (re)created defensively the same way 021 already established.

DO $$ BEGIN
  CREATE TYPE biller_category AS ENUM ('airtime', 'data', 'electricity', 'cable_tv', 'education');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE bill_payment_status AS ENUM (
    'pending_validation', 'validated', 'pending', 'completed', 'failed', 'reversed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── billers — add back whatever this database's copy is actually
-- missing. If every column below already exists, every line is a
-- silent no-op. ────────────────────────────────────────────────────
ALTER TABLE billers
  ADD COLUMN IF NOT EXISTS monnify_biller_id   TEXT,
  ADD COLUMN IF NOT EXISTS category            biller_category,
  ADD COLUMN IF NOT EXISTS name                TEXT,
  ADD COLUMN IF NOT EXISTS product_id          TEXT,
  ADD COLUMN IF NOT EXISTS product_name        TEXT,
  ADD COLUMN IF NOT EXISTS price_kobo          BIGINT,
  ADD COLUMN IF NOT EXISTS requires_validation BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active           BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at          TIMESTAMPTZ NOT NULL DEFAULT now();

-- The five NOT NULL text/enum columns above (monnify_biller_id,
-- category, name, product_id, product_name) can't carry a NOT NULL
-- constraint safely if they're being added fresh to a table that
-- already has rows — there'd be nothing to backfill them with. Since
-- this table is only ever written by sync_billers() (never by hand,
-- never by a customer-facing action), the correct fix if you hit a
-- NOT NULL violation here is to truncate and re-sync, not to invent
-- placeholder values:
--   TRUNCATE billers CASCADE;
--   -- then: python -m scripts.sync_billers
-- Uncomment the line below ONLY if the ALTER above fails on a NOT NULL
-- check against pre-existing incomplete rows:
-- TRUNCATE billers CASCADE;

CREATE INDEX IF NOT EXISTS idx_billers_category ON billers(category) WHERE is_active = true;

DO $$ BEGIN
  ALTER TABLE billers ADD CONSTRAINT billers_monnify_biller_id_product_id_key UNIQUE (monnify_biller_id, product_id);
EXCEPTION
  WHEN duplicate_table THEN NULL;   -- constraint already exists under a different auto-generated name
END $$;

-- ── bill_payment_requests — created fresh if 019 never got this far,
-- left untouched if it already exists correctly. ───────────────────
CREATE TABLE IF NOT EXISTS bill_payment_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id             UUID NOT NULL REFERENCES users(id),
    initiated_by            identity_request_initiated_by NOT NULL,
    officer_id              UUID REFERENCES users(id),
    biller_id               UUID NOT NULL REFERENCES billers(id),

    customer_reference      TEXT NOT NULL,
    amount_kobo             BIGINT NOT NULL,

    validation_reference    TEXT,
    validated_account_name  TEXT,

    monnify_transaction_reference TEXT,
    status                  bill_payment_status NOT NULL DEFAULT 'pending',
    failure_reason          TEXT,
    token                   TEXT,

    amount_charged_kobo     BIGINT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at            TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bill_payment_requests_customer ON bill_payment_requests(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bill_payment_requests_status   ON bill_payment_requests(status);
