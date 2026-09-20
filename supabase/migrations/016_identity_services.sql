-- ================================================================
-- MonieKing Contributors
-- Migration: 016_identity_services.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001–015.
--
-- Two tables:
--  1. identity_services   — the catalog behind the Quick Actions grid.
--     Director-priced, director-activated. Ships with is_active=false
--     everywhere except the Youverify-backed lookups confirmed against
--     their live docs (see backend/scripts/seed_identity_services.py).
--  2. identity_service_requests — the append-only history log every
--     portal's "<X> history" screen reads from, filtered by category
--     or service_id. Same never-store-the-raw-number principle as
--     014_kyc_verification.sql: request_payload / response_summary
--     hold MASKED values only (see _mask_payload in the router),
--     never a raw BVN/NIN/phone number or an uploaded ID document.
-- ================================================================

CREATE TYPE identity_service_category AS ENUM (
  'nimc', 'bvn', 'tin', 'attestation', 'cac', 'vendor', 'airtime', 'bills'
);

CREATE TYPE identity_request_status AS ENUM (
  'pending', 'completed', 'failed', 'reversed'
);

CREATE TYPE identity_request_initiated_by AS ENUM (
  'customer', 'officer'
);

CREATE TABLE IF NOT EXISTS identity_services (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category           identity_service_category NOT NULL,
  code               VARCHAR(80) UNIQUE NOT NULL,
  name               VARCHAR(120) NOT NULL,
  description        TEXT,
  provider           VARCHAR(40) NOT NULL DEFAULT 'youverify',
  provider_endpoint  VARCHAR(160),
  price_kobo         BIGINT NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT FALSE,
  required_fields    JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_by         UUID REFERENCES users(id),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity_service_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id           UUID NOT NULL REFERENCES identity_services(id),
  customer_id          UUID NOT NULL REFERENCES users(id),
  initiated_by         identity_request_initiated_by NOT NULL,
  officer_id           UUID REFERENCES users(id),
  status               identity_request_status NOT NULL DEFAULT 'pending',
  request_payload      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- MASKED values only, see migration note above
  response_summary     JSONB,                                -- MASKED values only
  failure_reason       TEXT,
  amount_charged_kobo  BIGINT NOT NULL DEFAULT 0,
  provider_reference   VARCHAR(120),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_identity_service_requests_customer
  ON identity_service_requests (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_service_requests_service
  ON identity_service_requests (service_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_identity_services_category
  ON identity_services (category);

-- ── Row Level Security — same pattern as 002_row_level_security.sql ──
ALTER TABLE identity_services         ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_service_requests ENABLE ROW LEVEL SECURITY;

-- Catalog: everyone authenticated can read it (the Quick Actions grid
-- needs is_active/price for every role); only directors write.
CREATE POLICY "identity_services_select" ON identity_services FOR SELECT USING (
  auth.uid() IS NOT NULL
);

CREATE POLICY "identity_services_write" ON identity_services FOR UPDATE USING (
  current_user_role() = 'director'
);

-- History: a customer sees only their own rows; officers/admins/directors
-- see any (officer scoping to their own zone's customers is enforced in
-- the API layer, same as elsewhere in this codebase — see users_select
-- above for the equivalent pattern on the users table).
CREATE POLICY "identity_service_requests_select" ON identity_service_requests FOR SELECT USING (
  customer_id = auth.uid()
  OR current_user_role() IN ('officer', 'admin', 'director')
);

CREATE POLICY "identity_service_requests_insert" ON identity_service_requests FOR INSERT WITH CHECK (
  customer_id = auth.uid()
  OR current_user_role() IN ('officer', 'admin', 'director')
);
