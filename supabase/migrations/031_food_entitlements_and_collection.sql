-- 031_food_entitlements_and_collection.sql
-- Migration for MonieKing Food Card Entitlement and QR Verification System.
-- Backs the authenticated food collection workflow for annual December 10
-- condiments distribution with two-factor verification (QR code + confidential 4-digit PIN),
-- atomic lock against double collection, and immutable collection audits.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'food_entitlement_status') THEN
    CREATE TYPE food_entitlement_status AS ENUM ('active', 'used', 'revoked', 'expired');
  END IF;
END $$;

-- ── 1. Food Collection Points (Distribution Hubs) ─────────────────
CREATE TABLE IF NOT EXISTS food_collection_points (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(120) NOT NULL,
  address     TEXT NOT NULL,
  zone_id     UUID REFERENCES zones(id) ON DELETE SET NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_collection_points_zone ON food_collection_points(zone_id);

-- ── 2. Food Entitlements (Passes for qualified completed cards) ───
CREATE TABLE IF NOT EXISTS food_entitlements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id             UUID NOT NULL UNIQUE REFERENCES contribution_cards(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qr_token            VARCHAR(64) NOT NULL UNIQUE,
  collection_pin      VARCHAR(10) NOT NULL,
  package_name        VARCHAR(120) NOT NULL DEFAULT 'Standard Holiday Food Package',
  year                INTEGER NOT NULL,
  status              food_entitlement_status NOT NULL DEFAULT 'active',
  failed_attempts     INTEGER NOT NULL DEFAULT 0,
  collection_point_id UUID REFERENCES food_collection_points(id) ON DELETE SET NULL,
  collected_at        TIMESTAMPTZ,
  collected_by        UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_entitlements_customer_year ON food_entitlements(customer_id, year);
CREATE INDEX IF NOT EXISTS idx_food_entitlements_qr_token      ON food_entitlements(qr_token);
CREATE INDEX IF NOT EXISTS idx_food_entitlements_status        ON food_entitlements(status);

-- ── 3. Food Collection Audits (Immutable log of all scans/claims) ─
CREATE TABLE IF NOT EXISTS food_collection_audits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_code     VARCHAR(32) NOT NULL UNIQUE,
  entitlement_id UUID NOT NULL REFERENCES food_entitlements(id) ON DELETE CASCADE,
  officer_id     UUID NOT NULL REFERENCES users(id),
  action         VARCHAR(50) NOT NULL, -- 'SCANNED', 'CONFIRMED', 'PIN_FAILED', 'REVOKED'
  ip_address     VARCHAR(50),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_food_collection_audits_entitlement ON food_collection_audits(entitlement_id);
CREATE INDEX IF NOT EXISTS idx_food_collection_audits_officer     ON food_collection_audits(officer_id);
CREATE INDEX IF NOT EXISTS idx_food_collection_audits_code        ON food_collection_audits(audit_code);

-- ── Row Level Security ───────────────────────────────────────────
ALTER TABLE food_collection_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE food_collection_audits ENABLE ROW LEVEL SECURITY;

-- Collection points: readable by all authenticated users
CREATE POLICY "food_collection_points_select" ON food_collection_points
  FOR SELECT TO authenticated USING (true);

-- Entitlements: Customers can read their own passes; staff can read all
CREATE POLICY "food_entitlements_customer_select" ON food_entitlements
  FOR SELECT TO authenticated USING (
    customer_id = auth.uid() OR current_user_role() IN ('officer', 'director', 'admin')
  );

-- Audits: Officers, Directors, and Admins can read audits
CREATE POLICY "food_collection_audits_staff_select" ON food_collection_audits
  FOR SELECT TO authenticated USING (
    current_user_role() IN ('officer', 'director', 'admin')
  );
