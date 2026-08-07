-- ================================================================
-- MonieKing Contributors — Director Portal Fusion
-- Migration: 003_director_portal.sql
--
-- Run this in Supabase Dashboard → SQL Editor, after 001 and 002.
--
-- Adds:
--   - two new system_config keys (food card rate, wallet withdrawal fee)
--     so the two currently-hardcoded values become director-editable
--   - pending_rate_changes (the deferred-pricing mechanic)
--   - instant_messages (scrolling ticker)
--   - promo_banners (dashboard carousel)
-- ================================================================

-- ── New config keys — moves hardcoded values into the editable table ──
-- food_card_rate_kobo: was hardcoded 100_000 (₦1,000/day) in card_service.py
-- wallet_instant_withdrawal_fee_kobo: was hardcoded 5_000 (₦50) in wallets.py
INSERT INTO system_config (key, value, description) VALUES
  ('food_card_rate_kobo',               '100000', 'Live Food Card daily contribution rate, in kobo. Changing this does NOT affect existing open cards — see pending_rate_changes for the deferred-change mechanic.'),
  ('wallet_instant_withdrawal_fee_kobo', '5000',   'Flat fee charged on every instant wallet withdrawal, in kobo. Applies immediately to new withdrawal requests.')
ON CONFLICT (key) DO NOTHING;

-- ── pending_rate_changes ─────────────────────────────────────────
-- A rate change a Director requests today always takes effect on
-- Jan 1 of the following year — see app/tasks/pricing.py for the
-- two scheduled jobs that read this table.
CREATE TYPE pending_rate_change_status AS ENUM ('scheduled', 'cancelled', 'applied');

CREATE TABLE pending_rate_changes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  setting_key         TEXT NOT NULL REFERENCES system_config(key),
  current_value_kobo  BIGINT NOT NULL,
  new_value_kobo      BIGINT NOT NULL CHECK (new_value_kobo > 0),
  effective_date      DATE NOT NULL,
  status              pending_rate_change_status NOT NULL DEFAULT 'scheduled',
  created_by          UUID NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_by        UUID REFERENCES users(id),
  cancelled_at        TIMESTAMPTZ,
  notified_at         TIMESTAMPTZ,
  applied_at          TIMESTAMPTZ
);

-- Only one active (scheduled) pending change per setting at a time
CREATE UNIQUE INDEX idx_pending_rate_changes_one_active
  ON pending_rate_changes (setting_key)
  WHERE status = 'scheduled';

CREATE INDEX idx_pending_rate_changes_effective ON pending_rate_changes(effective_date);

-- ── instant_messages ─────────────────────────────────────────────
-- The scrolling ticker bar. Only one active message per audience —
-- activating a new one deactivates the previous (enforced in the API).
CREATE TYPE instant_message_priority AS ENUM ('normal', 'urgent');

CREATE TABLE instant_messages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message        TEXT NOT NULL,
  priority       instant_message_priority NOT NULL DEFAULT 'normal',
  target_roles   TEXT NOT NULL DEFAULT 'all',   -- comma-separated roles or "all", same pattern as broadcasts
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at     TIMESTAMPTZ,
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_instant_messages_active ON instant_messages(is_active);

-- ── promo_banners ─────────────────────────────────────────────────
CREATE TYPE promo_banner_link_type AS ENUM ('none', 'internal_route', 'external_url');

CREATE TABLE promo_banners (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title          TEXT NOT NULL,
  subtitle       TEXT,
  gradient_from  TEXT NOT NULL DEFAULT '#052E16',  -- hex, defaults to brand green
  gradient_to    TEXT NOT NULL DEFAULT '#D97706',  -- hex, defaults to copper accent
  link_type      promo_banner_link_type NOT NULL DEFAULT 'none',
  link_target    TEXT,
  display_order  INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  target_roles   TEXT NOT NULL DEFAULT 'all',
  created_by     UUID NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_promo_banners_active ON promo_banners(is_active, display_order);

-- ── RLS — service role (backend) bypasses RLS entirely, these policies
-- only matter if the frontend ever queries these tables directly ──
ALTER TABLE pending_rate_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE instant_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE promo_banners        ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can read active instant messages / banners
CREATE POLICY instant_messages_read ON instant_messages
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY promo_banners_read ON promo_banners
  FOR SELECT USING (auth.role() = 'authenticated');

-- pending_rate_changes is director-only, checked via the users table
CREATE POLICY pending_rate_changes_director_only ON pending_rate_changes
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'director')
  );

-- ── Realtime — powers the "claimed by someone else" live notification ──
-- Directors' WithdrawalsPage subscribes to this table via Supabase Realtime
-- (Postgres Changes) so a losing claim updates instantly without polling.
-- (If this errors because the table is already in the publication, that's fine — skip it.)
ALTER PUBLICATION supabase_realtime ADD TABLE withdrawals;
